const Events = require('events')

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
            bterms = bterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(bterms)
        }
        let sterms = await global.search.history.terms()
        if(sterms.length){ // searching terms history
            sterms = sterms.slice(-24)
            sterms = sterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(sterms)
        }
        let hterms = global.histo.get()
        if(hterms.length){ // user history terms
            hterms = hterms.slice(-24)
            hterms = hterms.map(e => channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(hterms)
        }
        addTerms(await global.channels.keywords())
        const max = Math.max(...terms.map(t => t.score))
        let cterms = global.config.get('communitary-mode-interests')
        if(cterms){ // user specified interests
            cterms = this.master.terms(cterms, true).filter(c => c[0] != '-')
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
            let name = data.name || global.listNameFromURL(url)
            let author = data.author || undefined
            let icon = data.icon || undefined
            let length = data.length || info[url].length || 0
            let details = []
            if(author) details.push(author)
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
            return {
                url,
                details: this.master.lists[url] ? global.lang.LIST_ADDED : '',
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
                            global.explorer.refreshNow() // epg options path
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
        this.lastActiveEPGDetails = ''
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
        let urls = this.master.epgs
        if(Array.isArray(urls)){
            urls = urls.map(u => this.parseEPGURL(u, true)).flat()
            epgs.push(...urls)
        }
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
        epgs = epgs.sort().unique()
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
        const p = global.explorer.path
        if(p.indexOf(global.lang.EPG +'/'+ global.lang.OPTIONS) == -1) {
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
    activeEPG() {
        let activeEPG = global.config.get('epg-'+ global.lang.locale) || global.activeEPG
        if(!activeEPG || activeEPG == 'disabled'){
            activeEPG = ''
        }
        if(activeEPG){
            activeEPG = this.formatEPGURL(activeEPG) 
        }
        return activeEPG        
    }
    async startEPGStatusUpdating(activeEPG, activeEPGDetails) {
        if(activeEPG){            
            if(typeof(activeEPGDetails) != 'string'){
                await this.master.epg([], 2).then(epgData => {
                    this.lastActiveEPGDetails = activeEPGDetails = this.epgLoadingStatus(epgData)
                }).catch(err => {
                    console.error(err)
                    activeEPGDetails = ''
                })
            }
            if(activeEPGDetails == global.lang.ENABLED){
                if(this.epgStatusTimer){
                    clearInterval(this.epgStatusTimer)
                    this.epgStatusTimer = false
                }
            } else {
                this.epgStatusTimer && clearInterval(this.epgStatusTimer)
                this.epgStatusTimer = setInterval(this.updateEPGStatus.bind(this), 1000)
            }
        } else {
            this.lastActiveEPGDetails = ''
        }
    }
    async epgOptionsEntries(activeEPGDetails){
        let options = [], epgs = []
        await this.searchEPGs().then(urls => epgs.push(...urls)).catch(console.error)
        let activeEPG = this.activeEPG()
        if(activeEPG){
            epgs.includes(activeEPG) || epgs.push(activeEPG)
        }
        await this.startEPGStatusUpdating(activeEPG, activeEPGDetails).catch(global.displayErr)
        options = epgs.unique().sort().map(url => {
            let details = '', name = global.listNameFromURL(url)
            if(url == activeEPG){
                if(activeEPGDetails){
                    details = activeEPGDetails
                } else {
                    if(global.channels.loadedEPG == url){
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
                url,
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
                    global.explorer.refreshNow() // epg options path
                }
            }
        })
        options.unshift(this.addEPGEntry())
        return options
    }
    formatEPGURL(url){        
        const fragment = ',http'
        if(url && url.indexOf(fragment) != -1){
            url = url.split(',http').shift()
        }
        return url
    }
    addEPGEntry() {
        return {
            name: global.lang.ADD, fa: 'fas fa-plus-square',
            type: 'action', action: async () => {
                const url = await global.explorer.prompt({
                    question: global.lang.EPG,
                    placeholder: 'http://.../epg.xml', 
                    defaultValue: global.activeEPG || '',
                    fa: global.channels.epgIcon
                })
                if(url && url.length > 6) {
                    console.log('SET-EPG', url, global.activeEPG)
                    global.config.set('epg-'+ global.lang.locale, url || 'disabled')
                    global.lists.manager.setEPG(url, true).catch(console.error)
                    global.explorer.refresh()
                }
            }
        }
    }
    async setEPG(url, ui){
        console.log('SETEPG', url)
        if(typeof(url) == 'string'){
            if(url){
                url = this.formatEPGURL(url)
            }
            if(url == global.activeEPG) {
                return
            }
            if(!url || global.validateURL(url)) {
                global.activeEPG = url
                global.channels.loadedEPG = ''
                await this.loadEPG(url, ui)
                let refresh = () => {
                    if(global.explorer.path.indexOf(global.lang.EPG) != -1 || global.explorer.path.indexOf(global.lang.LIVE) != -1){
                        global.explorer.refreshNow()
                    }
                }
                if(!url){
                    global.channels.load()
                    if(ui){
                        global.osd.show(global.lang.EPG_DISABLED, 'fas fa-times-circle', 'epg', 'normal')                            
                    }
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
            global.channels.loadedEPG = ''
            if(!url && global.config.get('epg-'+ global.lang.locale) != 'disabled'){
                url = global.config.get('epg-'+ global.lang.locale)
            }
            if(!url && ui) ui = false
            if(ui){
                global.osd.show(global.lang.EPG_AVAILABLE_SOON, 'fas fa-check-circle', 'epg', 'normal')
            }
            console.log('loadEPG', url)
            this.master.loadEPG(url).then(() => {
                global.channels.loadedEPG = url
                global.channels.emit('epg-loaded', url)
                if(ui){
                    global.osd.show(global.lang.EPG_LOAD_SUCCESS, 'fas fa-check-circle', 'epg', 'normal')
                }
                if(global.explorer.path == global.lang.TRENDING || (global.explorer.path.startsWith(global.lang.LIVE) && global.explorer.path.split('/').length == 2)){
                    global.explorer.refresh()
                }
                resolve(true)
            }).catch(err => {
                console.error(err)
                global.osd.show(global.lang.EPG_LOAD_FAILURE + ': ' + String(err), 'fas fa-times-circle', 'epg', 'normal')
                reject(err)
            })
        })
    }
    epgEntry(){
        return {
            name: global.lang.EPG, 
            fa: global.channels.epgIcon, 
            type: 'group', details: 'EPG', 
            renderer: async () => {
                const entries = [
                    {
                        name: global.lang.SELECT,
                        type: 'group',
                        fa: 'fas fa-cog',
                        renderer: async () => {
                            const epgData = await this.master.epg([], 2)
                            return await this.epgOptionsEntries(this.epgLoadingStatus(epgData))
                        }
                    }
                ]
                if(global.channels.loadedEPG) {
                    entries.push(...[
                        global.channels.epgSearchEntry(),
                        global.channels.chooseChannelGridOption(true),
                        ...global.channels.channelList.getCategories().map(category => {
                            const rawname = global.lang.CATEGORY_KIDS == category.name ? '[fun]'+ category.name +'[|fun]' : category.name
                            return {
                                name: category.name,
                                rawname,
                                type: 'group',
                                renderer: () => this.epgCategoryEntries(category)
                            }
                        })
                    ])
                } else {
                    const activeEPG = this.activeEPG()
                    await this.startEPGStatusUpdating(activeEPG).catch(global.displayErr)
                    entries.push({
                        name: global.channels.loadedEPG ? global.lang.EMPTY : global.lang.EPG_DISABLED,
                        details: this.lastActiveEPGDetails,
                        fa: 'fas fa-info-circle',
                        type: 'action',
                        class: 'entry-empty',
                        action: () => {
                            const p = global.lang.MY_LISTS +'/'+ global.lang.EPG +'/'+ global.lang.OPTIONS
                            global.explorer.open(p).catch(console.error)
                        }
                    })
                }
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
        return channels.map(c => {
            return {
                name: c.name,
                type: 'group',
                renderer: async () => {
                    return await global.channels.epgChannelEntries(c)
                }
            }
        })
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
            global.streamer.on('hard-failure', es => this.checkListExpiral(es).catch(console.error))
            global.explorer.prependFilter(async (es, path) => {
                es = await this.expandEntries(es, path)
                return this.labelify(es)
            })
            this.master.on('unsatisfied', () => this.update())
            this.master.on('epg-update', () => global.explorer.updateHomeFilters())            
        })
        global.ui.on('explorer-back', () => {
            if(this.openingList){
                global.osd.hide('list-open')
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
    waitListsReady(timeoutSecs){
        return new Promise(resolve => {
            const listener = info => {
                if(this.master.satisfied && info.length) {
                    this.master.removeListener('satisfied', listener)
                    resolve(true)
                }
            }
            this.master.on('satisfied', listener)
            typeof(timeoutSecs) == 'number' && setTimeout(() => resolve(false), timeoutSecs * 1000)
            listener(this.master.status())
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
            this.master.search(mega.terms, {
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
        if(url.startsWith('//')){
            url = 'http:'+ url
        }
        const fs = require('fs'), isURL = global.validateURL(url), isFile = this.isLocal(url)
        console.error('lists.add '+url+' | '+ name +' | '+ isFile +' | '+ !isURL)
        if(!isFile && !isURL){
            throw global.lang.INVALID_URL_MSG +' Not a file or URL'
        }
        let lists = this.get()
        for(let i in lists){
            if(lists[i][1] == url){
                throw global.lang.LIST_ALREADY_ADDED
            }
        }
        this.addingList = true
        global.explorer.path.endsWith(global.lang.MY_LISTS) && global.explorer.refreshNow()
        
        const cacheFile = global.storage.raw.resolve(global.LIST_DATA_KEY_MASK.format(url))
        const stat = await fs.promises.stat(cacheFile).catch(console.error)
        if(stat && stat.size && stat.size < 16384) {
            await fs.promises.unlink(cacheFile).catch(console.error) // invalidate possibly bad caches
        }
        const fetch = new this.master.Fetcher(url, {
            progress: p => {
                global.osd.show(global.lang.RECEIVING_LIST +' '+ p +'%', 'fa-mega spin-x-alt', 'add-list-progress-'+ uid, 'persistent')
            },
            timeout: global.config.get('read-timeout')
        }, this.master)
        let err, entries = await fetch.getMap().catch(e => err = e)
        this.addingList = false
        global.explorer.path.endsWith(global.lang.MY_LISTS) && global.explorer.refreshNow()
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
            throw global.lang.INVALID_URL_MSG +' - '+ (err || fetch.error || 'No M3U entries were found')
        }
    }
    async addList(listUrl, name, fromCommunity){
        let err
        const uid = parseInt(Math.random() * 100000)
        global.osd.show(global.lang.RECEIVING_LIST, 'fa-mega spin-x-alt', 'add-list-progress-'+ uid, 'persistent')
        global.ui.emit('background-mode-lock', 'add-list')
        listUrl = global.forwardSlashes(listUrl)
        await this.add(listUrl, name, uid).catch(e => err = e)
        global.osd.hide('add-list-progress-'+ uid)
        global.ui.emit('background-mode-unlock', 'add-list')
        if(typeof(err) != 'undefined'){
            throw err
        } else {
            global.osd.show(global.lang.LIST_ADDED, 'fas fa-check-circle', 'add-list', 'normal')
            const isURL = global.validateURL(listUrl)
            const sensible = listUrl.match(new RegExp('(pwd?|pass|password)=', 'i')) || listUrl.indexOf('@') != -1 || listUrl.indexOf('supratv') != -1 // protect sensible lists
            let makePrivate
            if(fromCommunity) {
                makePrivate = false
            } else if(!isURL || sensible) {
                makePrivate = true
                global.config.set('communitary-mode-lists-amount', 0) // disable community lists to focus on user list
            } else {
                const chosen = await global.explorer.dialog([
                    {template: 'question', text: global.lang.COMMUNITY_LISTS, fa: 'fas fa-users'},
                    {template: 'message', text: global.lang.WANT_SHARE_COMMUNITY},
                    {template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-lock'},
                    {template: 'option', text: lang.SHARE, id: 'yes', fa: 'fas fa-users'}
                ], 'no') // set local files as private
                if(chosen == 'yes') {
                    makePrivate = false
                    global.osd.show(global.lang.COMMUNITY_THANKS_YOU, 'fas fa-heart faclr-purple', 'communitary-lists-thanks', 'normal')
                } else {
                    makePrivate = true
                    global.config.set('communitary-mode-lists-amount', 0) // disable community lists to focus on user lists
                }
            }
            this.setMeta(listUrl, 'private', makePrivate)
            await this.askAddEPG(listUrl)
            global.explorer.refreshNow() // epg options path
            return true
        }
    }
    async askAddEPG(listUrl) {
        let info, i = 20
        while(i > 0 && (!info || !info[listUrl])){
            i--
            await this.wait(500)
            info = await this.master.info()
        }
        if(info && info[listUrl] && info[listUrl].epg){
            const currentEPG = global.config.get('epg-'+ global.lang.locale)
            info[listUrl].epg = this.parseEPGURL(info[listUrl].epg, false)
            if(global.validateURL(info[listUrl].epg) && info[listUrl].epg != currentEPG){
                const sample = await global.Download.get({url: info[listUrl].epg, range: '0-512', responseType: 'text'})
                if(typeof(sample) != 'string' || sample.toLowerCase().indexOf('<tv') == -1) return
                let chosen = await global.explorer.dialog([
                    {template: 'question', text: ucWords(global.MANIFEST.name), fa: 'fas fa-star'},
                    {template: 'message', text: global.lang.ADDED_LIST_EPG},
                    {template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                    {template: 'option', text: global.lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle'}
                ], 'yes')
                if(chosen == 'yes'){
                    global.config.set('epg-'+ global.lang.locale, info[listUrl].epg)
                    await this.setEPG(info[listUrl].epg, true)
                    console.error('XEPG', chosen)
                }
            }
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
    async name(url, content=''){
        let name = this.getMeta(url, 'name')
        if(!name){
            if(content){
                name = this.nameFromContent(content)
            }
            if(typeof(name) != 'string' || !name){
                name = global.listNameFromURL(url)
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
			if(file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/'){ // unix path
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
        
        if(!this.receivedCommunityListsListener) {
            this.receivedCommunityListsListener = () => { // live update received lists view
                if(global.explorer.path && global.explorer.basename(global.explorer.path) == global.lang.RECEIVED_LISTS) {
                    global.explorer.refresh()
                }
            }
            this.master.on('status', this.receivedCommunityListsListener)
        }

        if(this.master.satisfied || this.isUpdating || (!p.length && !c)) return

        let lastProgress = -1
        const listener = c => p = c
        const processStatus = () => {
            if(lastProgress >= p.progress) return
            lastProgress = p.length ? p.progress : 0
            let m, fa = 'fa-mega spin-x-alt', duration = 'persistent'
            if(this.master.satisfied) {
                clearInterval(this.isUpdating)
                delete this.isUpdating
                if(p.length) {
                    this.master.off('status', listener)
                    this.master.off('satisfied', listener)
                    this.master.off('unsatisfied', listener)
                    m = global.lang.LISTS_UPDATED
                    this.master.isFirstRun = false
                } else {
                    m = -1 // do not show 'lists updated' message yet
                }
                fa = 'fas fa-check-circle'
                duration = 'normal'
                this.master.removeListener('status', listener)
            } else {
                m = global.lang[p.firstRun ? 'STARTING_LISTS_FIRST_TIME_WAIT' : 'UPDATING_LISTS'] +' '+ p.progress +'%'
            }
            if(m != -1) { // if == -1 it's not complete yet, no lists
                global.osd.show(m, fa, 'update-progress', duration)
            }
            if(global.explorer && global.explorer.currentEntries) {
                const updateEntryNames = [global.lang.PROCESSING, global.lang.UPDATING_LISTS, global.lang.STARTING_LISTS]
                const updateBaseNames = [global.lang.TRENDING, global.lang.COMMUNITY_LISTS]
                if(
                    updateBaseNames.includes(global.explorer.basename(global.explorer.path)) || 
                    global.explorer.currentEntries.some(e => updateEntryNames.includes(e.name))
                ) {
                    if(m == -1) {
                        global.explorer.refreshNow()
                    } else {
                        global.explorer.refresh()
                    }                    
                } else if(this.inChannelPage()) {
                    this.maybeRefreshChannelPage()
                }
            }
        }
        this.master.on('status', listener)
        this.master.on('satisfied', listener)
        this.master.on('unsatisfied', listener)
        this.master.loader.on('progresses', () => listener(global.lists.status()))
        this.isUpdating = setInterval(processStatus, 1000)

        global.osd.show(m, 'fa-mega spin-x-alt', 'update-progress', 'persistent')
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
                        global.explorer.open(global.lang.MY_LISTS).catch(console.error)
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
                this.addListDialog(offerCommunityMode).catch(global.displayErr)
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
        extraOpts.push({template: 'option', text: global.lang.ADD_MAC_ADDRESS, fa: 'fas fa-hard-drive', id: 'mac'})
        let id = await global.explorer.prompt({
            question: global.lang.ASK_IPTV_LIST,
            placeholder: 'http://',
            fa: 'fas fa-plus-square',
            extraOpts
        })
        console.log('lists.manager '+ id)
        if(id == 'file'){
            return await this.addListDialogFile()
        } else if(id == 'code') {
            return await this.addListCredentialsDialog()
        } else if(id == 'sh') {
            let active = await this.communityModeDialog()
            if(active){
                return true
            } else {
                return await this.addListDialog(offerCommunityMode)
            }
        } else if(id == 'mac') {
            return await this.addListMacDialog()
        } else {
            console.log('lists.manager.addList('+ id +')')
            return await this.addList(id)
        }
    }
    addListDialogFile(){
        return new Promise((resolve, reject) => {
            const id = 'add-list-dialog-file-'+ parseInt(10000000 * Math.random())
            global.ui.once(id, data => {
                console.error('!!! IMPORT M3U FILE !!! '+ JSON.stringify(data))
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
    async addListCredentialsDialog(){     
        const url = await this.askListCredentials()
        return await this.addList(url)
    }  
    async askListCredentials(){     
        let server = await global.explorer.prompt({
            question: global.lang.PASTE_SERVER_ADDRESS,
            placeholder: 'http://host:port',
            fa: 'fas fa-globe'
        })
        if(!server) throw 'no server provided'
        if(server.charAt(server.length - 1) == '/') {
            server = server.substr(0, server.length - 1)
        }
        if(server.startsWith('/')) {
            server = 'http:'+ server
        }
        if(server.indexOf('username=') != -1) {
            return server
        }
        const user = await global.explorer.prompt({
            question: global.lang.USERNAME,
            placeholder: global.lang.USERNAME,
            fa: 'fas fa-user'
        })
        if(!user) throw 'no user provided'
        const pass = await global.explorer.prompt({
            question: global.lang.PASSWORD,
            placeholder: global.lang.PASSWORD,
            fa: 'fas fa-key',
            isPassword: true
        })
        if(!pass) throw 'no pass provided'
        global.osd.show(global.lang.PROCESSING, 'fa-mega spin-x-alt', 'add-list-pre', 'persistent')
        let url = await this.getM3UFromCredentials(server, user, pass).catch(console.error)
        if(typeof(url) != 'string') {
            url = server.replace('//', '//'+ user +':'+ pass +'@') +'#xtream'
            let chosen = await global.explorer.dialog([
                {template: 'question', text: global.ADD_USER_PASS, fa: 'fas fa-key'},
                {template: 'message', text: global.lang.INCLUDE_SERIES_CATALOG},
                {template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                {template: 'option', text: global.lang.NO, id: 'no', fa: 'fas fa-times-circle'}
            ], 'yes').catch(console.error)
            if(chosen == 'no') url += '-all'
        }
        global.osd.hide('add-list-pre')
        return url
    }
    async debugCredentials() {
        let err
        const data = {version: global.MANIFEST.version}
        const {promises: fsp} = require('fs'), Xtr = require('./xtr')
        const output = global.paths.temp+ '/xtr-'+ parseInt(Math.random() * 10000000) +'.log.txt'
        const url = await this.askListCredentials().catch(e => err = e)
        if(err) {
            data.askListCredentials = String(err)
        } else {
            data.askListCredentials = url
            if(url.indexOf('#xtream') != -1) {
                const xtr = new Xtr(url, true)
                await xtr.run().catch(e => err = e)
                data.calls = xtr.debugInfo
                if(err) data.run = String(err)
                xtr.destroy()
            }
        }
        await fsp.writeFile(output, global.crashlog.stringify(data))
        await global.downloads.serve(output, true)
    }
    async getM3UFromCredentials(server, user, pass) {
        const masks = [
            '{0}/get.php?username={1}&password={2}&output=mpegts&type=m3u_plus',
            '{0}/get.php?username={1}&password={2}&output=ts&type=m3u_plus',
            '{0}/get.php?username={1}&password={2}&output=hls&type=m3u_plus',
            '{0}/get.php?username={1}&password={2}&type=m3u_plus'
        ]
        if(server.indexOf('username=') != -1) {
            masks.push(server)
        }
        for(const mask of masks) {
            const url = mask.format(server, user, pass)
            const ret = await global.Download.head({url}).catch(() => {})
            if(ret && ret.statusCode == 200) return url
        }
        throw 'Invalid credentials.'
    }
    async addListMacDialog() {
        const macAddress = this.formatMacAddress(await global.explorer.prompt({
            question: global.lang.MAC_ADDRESS,
            placeholder: '00:00:00:00:00:00',
            fa: 'fas fa-hard-drive'
        }))
        if(!macAddress || macAddress.length != 17) throw 'Invalid MAC address'
        let server = await global.explorer.prompt({
            question: global.lang.PASTE_SERVER_ADDRESS,
            placeholder: 'http://host:port',
            fa: 'fas fa-globe'
        })
        if(!server) throw 'Invalid server provided'
        if(server.charAt(server.length - 1) == '/') {
            server = server.substr(0, server.length - 1)
        }
        const url = await this.getM3UPlaylistForMac(macAddress, server)
        return await this.addList(url)
    }
    formatMacAddress(str) {
        if(!str) return ''
        const mask = []
        const filteredStr = str.replace(new RegExp('[^0-9a-fA-F]', 'g'), '').toUpperCase()
        for (let i = 0; i < 12; i += 2) {
            mask.push(filteredStr.substr(i, 2))
        }
        return mask.join(':').substr(0, 17)
    }
    async getM3UPlaylistForMac(mac, baseUrl) {
        const macAddress = encodeURIComponent(mac)
        const tokenUrl = '/portal.php?action=handshake&type=stb&token='
        const profileUrl = '/portal.php?type=stb&action=get_profile'
        const listUrl = '/portal.php?action=get_ordered_list&type=vod&p=1&JsHttpRequest=1-xml'
        const firstToken  = (await global.Download.get({
            url: baseUrl + tokenUrl,
            responseType: 'json'
        })).js.token
        const secondToken = (await global.Download.get({
            url: baseUrl + tokenUrl,
            responseType: 'json',
            headers: {
                'authorization': 'Bearer '+ firstToken,
                'cookie': 'mac='+ macAddress +'; stb_lang=en; timezone=Europe%2FAmsterdam'
            }
        })).js.token
        /*
        const profileId = await global.Download.get({ // is this call required?
            url: baseUrl + profileUrl,
            responseType: 'json',
            headers: {
                'authorization': 'Bearer '+ secondToken,
                'cookie': 'mac='+ macAddress +'; stb_lang=en; timezone=Europe%2FAmsterdam'
            }
        }).js.id
        if (typeof(profileId) === 'undefined') throw 'Profile not found'
        */       
        await global.Download.get({ // is this call required for auth?
            url: baseUrl + profileUrl,
            responseType: 'json',
            headers: {
                'authorization': 'Bearer '+ secondToken,
                'cookie': 'mac='+ macAddress +'; stb_lang=en; timezone=Europe%2FAmsterdam'
            }
        })
        const list = await global.Download.get({
            url: baseUrl + listUrl, 
            responseType: 'json',
            headers: {
                'authorization': 'Bearer '+ secondToken,
                'cookie': 'mac='+ macAddress +'; stb_lang=en; timezone=Europe%2FAmsterdam'
        }})
        const cmd = list.js.data[0].cmd
        const commandUrl = '/portal.php?action=create_link&type=vod&cmd='+ cmd +'a&JsHttpRequest=1-xml'
        const res = (await global.Download.get({
            url: baseUrl + commandUrl,
            responseType: 'json',
            headers: {
                'authorization': 'Bearer '+ secondToken,
                'cookie': 'mac='+ macAddress +'; stb_lang=en; timezone=Europe%2FAmsterdam'
            }
        })).js.cmd.split('/')
        if (res.length < 6) return false
        const usr = res[4], pw = res[5]
        return baseUrl +'/get.php?username='+ encodeURIComponent(usr) +'&password='+ encodeURIComponent(pw) +'&type=m3u&output=ts'
    }   
    listsEntry(manageOnly){
        return {
            name: manageOnly ? global.lang.IPTV_LISTS : global.lang.MY_LISTS, 
            details: manageOnly ? global.lang.CONFIGURE : global.lang.IPTV_LISTS, 
            type: 'group',
            fa: 'fas fa-list',
            renderer: async () => {
                let lists = this.get()
                const extInfo = await this.master.info(true)
                const doNotShareHint = !global.config.get('communitary-mode-lists-amount')
                let ls = []
                for(const row of lists){
                    let url = row[1]
                    if(!extInfo[url]) extInfo[url] = {}
                    let name = extInfo[url].name || row[0] || global.listNameFromURL(url)
                    let details = [extInfo[url].author || '', '<i class="fas fa-play-circle"></i> '+ global.kfmt(extInfo[url].length || 0)].filter(n => n).join(' &nbsp;&middot;&nbsp; ')
                    let icon = extInfo[url].icon || undefined
                    let priv = (row.length > 2 && typeof(row[2]['private']) != 'undefined') ? row[2]['private'] : doNotShareHint 
                    let expired = await this.master.isListExpired(url, false)
                    let flag = expired ? 'fas fa-exclamation-triangle faclr-red' : (priv ? 'fas fa-lock' : 'fas fa-users')
                    ls.push({
                        prepend: '<i class="'+ flag +'"></i>&nbsp;',
                        name, url, icon, details,
                        fa: 'fas fa-satellite-dish',
                        type: 'group',
                        class: 'skip-testing',
                        renderer: async () => {
                            let es = []     
                            let contactUrl, contactFa
                            const meta = this.master.lists[url] ? this.master.lists[url].index.meta : {}
                            if(meta.site) {
                                contactUrl = meta.site
                                contactFa = 'fas fa-globe'
                            } else if(meta.email) {
                                contactUrl = 'mailto:'+ meta.email
                                contactFa = 'fas fa-envelope'
                            } else if(meta.phone) {
                                contactUrl = 'tel:+'+ meta.phone.replace(new RegExp('[^0-9]+'), '')
                                contactFa = 'fas fa-phone'
                            }
                            const options = [
                                {
                                    name: global.lang.RENAME, 
                                    fa: 'fas fa-edit', 
                                    type: 'input', 
                                    class: 'skip-testing', 
                                    action: (e, v) => {
                                        if(v !== false){
                                            let path = global.explorer.path, parentPath = global.explorer.dirname(path)
                                            if(path.indexOf(name) != -1){
                                                path = path.replace('/'+ name, '/'+ v)
                                            } else {
                                                path = false
                                            }
                                            name = v
                                            this.rename(url, v)
                                            if(path){
                                                if(parentPath) delete global.explorer.pages[parentPath]
                                                global.explorer.open(path).catch(global.displayErr)
                                            } else {
                                                global.explorer.back(null, true)
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
                            if(contactUrl) {
                                options.splice(2, 0, {
                                    name: global.lang.CONTACT_PROVIDER, 
                                    type: 'action',
                                    fa: contactFa,
                                    action: () => {
                                        global.ui.emit('open-external-url', contactUrl)
                                    }
                                })
                            }
                            if(manageOnly) return options
                            es = await this.directListRenderer({url}, {
                                raw: true,
                                fetch: false
                            }).catch(err => global.displayErr(err))
                            if(!Array.isArray(es)){
                                es = []
                            } else if(es.length) {
                                es = this.master.parentalControl.filter(es)
                                es = await this.master.tools.deepify(es,  {source: url})  
                            }
                            es.unshift({
                                name: global.lang.OPTIONS,
                                fa: 'fas fa-bars', 
                                type: 'select',
                                entries: options
                            })
                            return es
                        }
                    })
                }
                if(this.addingList){
                    ls.push({
                        name: global.lang.RECEIVING_LIST,
                        fa: 'fa-mega spin-x-alt',
                        type: 'action',
                        action: () => global.explorer.refresh()
                    })
                }
                ls.push(this.addListEntry())
                if(manageOnly) {
                    const e = this.addEPGEntry()
                    e.name = global.lang.EPG
                    e.details = 'EPG'
                    ls.push(e)
                } else {
                    ls.push(this.listSharingEntry())
                    ls.push(this.epgEntry())
                }
                return ls
            }
        }
    }
    async refreshList(data){
        let updateErr
        await this.master.loader.reload(data.url).catch(e => updateErr = e)
        if(updateErr){
            if(updateErr == 'empty list' || updateErr == 'empty index'){
                let haserr, msg = updateErr
                const ret = await global.Download.head({url: data.url}).catch(err => haserr = err)
                if(ret && typeof(ret.statusCode) == 'number'){
                    switch(String(ret.statusCode)){
                        case '200':
                        case '210':
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
            global.explorer.refreshNow()
            global.displayErr(updateErr)
        } else {
            await global.lists.loadList(data.url).catch(err => updateErr = err)
            global.explorer.refreshNow()
            if(updateErr){
                global.displayErr(updateErr)
            } else {
                global.osd.show('OK', 'fas fa-check-circle faclr-green', 'refresh-list', 'normal')
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
        global.explorer.back(null, true)
    }
    async directListRenderer(data, opts={}){
        let v = Object.assign({}, data)
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
                            global.explorer.refreshNow() // epg options path
                        }
                    })
                } else {
                    list.unshift({
                        type: 'action',
                        fa: 'fas fa-plus-square',
                        name: global.lang.ADD_TO.format(global.lang.MY_LISTS),
                        action: () => {
                            this.addList(v.url, '', true).catch(console.error).finally(() => {
                                setTimeout(() => global.explorer.refreshNow(), 100)
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
    async checkListExpiral(es){
        if(!this.master.activeLists.my.length) return
        if(!this.checkListExpiralTimes) this.checkListExpiralTimes = {}
        if(!es || !es.length) es = this.master.myLists.map(source => ({source}))
        const now = global.time()
        const checkListExpiralInterval = this.master.activeLists.community.length ? 120 : 10
        const myBadSources = es.map(e => e.source).filter(e => e).unique().filter(u => this.master.activeLists.my.includes(u))
        for(const source of myBadSources) {
            if(this.checkListExpiralTimes[source] && (now < (this.checkListExpiralTimes[source] + checkListExpiralInterval))) {
                continue
            }
            this.checkListExpiralTimes[source] = now
            let expired
            await this.master.isListExpired(source, true).then(e => expired = e).catch(err => {
                console.error(err)
                expired = true // 'no valid links' error
            })
            if(expired) {
                const meta = this.master.lists[source].index.meta
                const name = meta.name || meta.author || global.MANIFEST.name
                const opts = [
                    { template: 'question', text: name, fa: 'fas fa-exclamation-triangle faclr-red' },
                    { template: 'message', text: global.lang.IPTV_LIST_EXPIRED +"\r\n\r\n"+ source },
                    { template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' }
                ]
                let contactUrl, contactFa
                if(meta.site) {
                    contactUrl = meta.site
                    contactFa = 'fas fa-globe'
                } else if(meta.email) {
                    contactUrl = 'mailto:'+ meta.email
                    contactFa = 'fas fa-envelope'
                } else if(meta.phone) {
                    contactUrl = 'tel:+'+ meta.phone.replace(new RegExp('[^0-9]+'), '')
                    contactFa = 'fas fa-phone'
                }
                let offer
                if(contactUrl) {
                    opts.push({
                        template: 'option',
                        text: global.lang.CONTACT_PROVIDER,
                        id: 'contact',
                        fa: contactFa
                    })
                } else {
                    offer = await global.promo.offer('dialog', ['communitary']).catch(console.error)
                    if(offer && offer.type == 'dialog') {
                        opts.push({
                            template: 'option',
                            text: offer.title,
                            id: 'offer',
                            fa: offer.fa
                        })
                    }
                }
                const ret = await global.explorer.dialog(opts)
                if(ret == 'contact') {
                    global.ui.emit('open-external-url', contactUrl)
                } else if(ret == 'offer') {
                    await global.promo.dialogOffer(offer)
                }
            }
        }
    }
    async hook(entries, path){
        if(!path) {
            const entry = this.listsEntry(false)
            global.options.insertEntry(entry, entries, -2, global.lang.TOOLS, [
                global.lang.BOOKMARKS,
                global.lang.KEEP_WATHING,
                global.lang.RECOMMENDED_FOR_YOU,
                global.lang.CATEGORY_MOVIES_SERIES
            ])
        }
        return entries
    }
}

module.exports = Manager
