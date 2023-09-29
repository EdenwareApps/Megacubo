const Events = require('events'), pLimit = require('p-limit')

class SearchTermsHistory {
    constructor(){
        this.key = 'search-terms-history'
        this.maxlength = 12
    }
    async get(){
        let ret = await global.storage.promises.get(this.key)
        if(!Array.isArray(ret)){
            ret = []
        }
        return ret
    }
    add(terms){
        if(!Array.isArray(terms)){
            terms = global.lists.terms(terms)
        }
        this.get().then(vs => {
            let tms = terms.join('')
            vs = vs.filter(v => v.join('') != tms).slice((this.maxlength - 1) * -1)
            vs.push(terms)
            global.storage.set(this.key, vs, true)
        })
    }
    async terms(){
        let ret = await this.get()
        return ret.flat().unique()
    }
}

class Search extends Events {
    constructor(){
        super()
        this.history = new SearchTermsHistory()
        this.searchMediaType = 'all'
        this.searchInaccurate = true
        this.searchStrict = false
        this.searchSuggestions = []
        this.currentSearchType = null
        this.currentSearch = null
        this.currentEntries = null
        this.currentResults = []
    }
    entriesLive(){
        if(this.currentSearchType != 'live'){
            this.currentSearchType = 'live'
            this.searchMediaType = 'live'
            this.currentEntries = null
        }
        return new Promise((resolve, reject) => {
            if(this.currentEntries){
                return resolve(this.currentEntries)
            }
            this.searchSuggestionEntries().then(es => {
                es = es.map(e => {
                    return {
                        name: global.ucWords(e.search_term),
                        fa: 'fas fa-search'
                    }
                })
                es = es.map(e => global.channels.toMetaEntry(e, false))
                es = global.lists.parentalControl.filter(es, true)
                es = this.addFixedEntries(this.currentSearchType, es)
                resolve(es)
            }).catch(global.displayErr)
        })
    }
    entries(){
        if(this.currentSearchType != 'all'){
            this.currentSearchType = 'all'
            this.searchMediaType = 'all'
            this.currentEntries = null
        }
        return new Promise((resolve, reject) => {
            if(this.currentEntries){
                return resolve(this.currentEntries)
            }
            resolve(this.addFixedEntries(this.currentSearchType, []))
        })
    }
    async go(value, mediaType){
        if(!value) return false
        if(!mediaType){
            mediaType = 'all'
        }
        console.log('search-start', value)
        global.ui.emit('set-loading', {name: global.lang.SEARCH}, true, global.lang.SEARCHING)
        global.osd.show(global.lang.SEARCHING, 'fas fa-search spin-x-alt', 'search', 'persistent')
        this.searchMediaType = mediaType
        let err
        const rs = await this[mediaType == 'live' ? 'channelsResults' : 'results'](value).catch(e => err = e)
        global.osd.hide('search')
        if(Array.isArray(rs)){
            console.log('results', rs)
            if(!rs.length && mediaType == 'live'){
                return this.go(value, 'all')
            }
            this.emit('search', {query: value})
            if(!global.explorer.path){
                global.explorer.path = global.lang.SEARCH
            }
            const resultsCount = rs.length
            global.explorer.render(this.addFixedEntries(mediaType, rs), global.explorer.path, 'fas fa-search', '/')
            global.osd.show(global.lang.X_RESULTS.format(resultsCount), 'fas fa-check-circle', 'search', 'normal')
        } else {
            global.displayErr(err)
        }
        global.ui.emit('set-loading', {name: global.lang.SEARCH}, false)
        global.search.history.add(value)
    }
    refresh(){
        if(this.currentSearch){
            this.go(this.currentSearch.name, this.currentSearchType)
        }
    }
    mediaTypeName(){
        let type = String(this.searchMediaType).toUpperCase()
        if(typeof(global.lang[type]) == 'string'){
            type = global.lang[type]
        }
        return type
    }
    addFixedEntries(mediaType, es){
        es.unshift({
            name: global.lang.NEW_SEARCH,
            details: this.mediaTypeName(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType)
                this.go(value, mediaType)
            },
            value: () => {
                return this.defaultTerms()
            },
            placeholder: global.lang.SEARCH_PLACEHOLDER
        })
        if(this.currentSearch){
            if(mediaType == 'live'){
                es.push({
                    name: global.lang.MORE_RESULTS,
                    details: global.lang.SEARCH_MORE,
                    type: 'action',
                    fa: 'fas fa-search-plus',
                    action: async () => {
                        let opts = [
                            {template: 'question', text: global.lang.SEARCH_MORE, fa: 'fas fa-search-plus'},
                            {template: 'option', text: global.lang.EPG, details: global.lang.LIVE, fa: 'fas fa-th', id: 'epg'},
                            {template: 'option', text: global.lang.IPTV_LISTS, details: global.lang.CATEGORY_MOVIES_SERIES, fa: 'fas fa-list', id: 'lists'}
                        ], def = 'epg'
                        let ret = await global.explorer.dialog(opts, def)
                        if(ret == 'epg'){
                            global.channels.epgSearch(this.currentSearch.name).then(entries => {
                                entries.unshift(global.channels.epgSearchEntry())
                                let path = global.explorer.path.split('/').filter(s => s != global.lang.SEARCH).join('/')
                                global.explorer.render(entries, path + '/' + global.lang.SEARCH, 'fas fa-search', path)
                                global.search.history.add(this.currentSearch.name)
                            }).catch(global.displayErr)
                        } else {
                            this.go(this.currentSearch.name, 'all')
                        }
                    }
                })
            }
        }
        return es
    }
    async results(terms){
        let u = global.ucWords(terms)
        this.currentSearch = {
            name: u, 
            url: global.mega.build(u, {terms, mediaType: this.searchMediaType})
        }
        if(!global.lists.loaded()){
            return [global.lists.manager.updatingListsEntry()]
        }
        if(!global.lists.activeLists.length){ // one list available on index beyound meta watching list
            return [global.lists.manager.noListsEntry()]
        }
        console.log('will search', terms, {
            partial: this.searchInaccurate, 
            type: this.searchMediaType, 
            typeStrict: this.searchStrict,
            group: this.searchMediaType != 'live'
        })
        const policy = global.config.get('parental-control')
        const parentalControlActive = ['remove', 'block'].includes(policy)
        const isAdultQueryBlocked = policy == 'remove' && !global.lists.parentalControl.allow(u)
        let es = await global.lists.search(terms, {
            partial: this.searchInaccurate, 
            type: this.searchMediaType, 
            typeStrict: this.searchStrict,
            group: this.searchMediaType != 'live',
            parentalControl: policy == 'remove' ? false : undefined // allow us to count blocked results
        })
        es = (es.results && es.results.length) ? es.results : ((es.maybe && es.maybe.length) ? es.maybe : [])
        console.log('has searched', terms, es.length, parentalControlActive, isAdultQueryBlocked)
        if(isAdultQueryBlocked) {
            es = [
                {
                    prepend: '<i class="fas fa-info-circle"></i> ',
                    name: global.lang.X_BLOCKED_RESULTS.format(es.length),
                    details: global.lang.ADULT_CONTENT_BLOCKED,
                    fa: 'fas fa-lock',
                    type: 'action',
                    action: () => {
                        global.explorer.info(global.lang.ADULT_CONTENT_BLOCKED, global.lang.ADULT_CONTENT_BLOCKED_INFO.format(global.lang.OPTIONS, global.lang.ADULT_CONTENT))
                    }
                }
            ]
        } else {
            this.currentResults = es.slice(0)
            let minResultsWanted = (global.config.get('view-size-x') * global.config.get('view-size-y')) - 3
            if(global.config.get('search-youtube') && es.length < minResultsWanted){                
                let ys = await this.ytResults(terms).catch(console.error)
                if(Array.isArray(ys)) {
                    es.push(...ys)
                }
            }
            if(es.length) {
                es = global.lists.parentalControl.filter(es)
            }
        }
        global.ui.emit('current-search', terms, this.searchMediaType)
        return es
    }
    fixYTTitles(name){
        return name.replaceAll('/', '|')
    }
    async ytResults(tms){
        if(!this.ytsr){
            this.ytsr = require('ytsr')
        }
        let terms = tms
        if(Array.isArray(terms)){
            terms = terms.join(' ')
        }
        const filters = await this.ytsr.getFilters(terms)
        const filter = filters.get('Type').get('Video')
        const options = {
            pages: 2,
            gl: global.lang.countryCode.toUpperCase(),
            hl: global.lang.locale,    
            requestOptions: {
                rejectUnauthorized: false,
                transform: (parsed) => {
                    return Object.assign(parsed, {
                        rejectUnauthorized: false
                    })
                }
            }
        }
        const results = await this.ytsr(filter.url, options)
        return results.items.filter(t => t && !t.isLive).map(t => {
            let icon = t.thumbnails ? t.thumbnails.sortByProp('width').shift().url : undefined
            return {
                name: this.fixYTTitles(t.title),
                icon,
                type: 'stream',
                url: t.url
            }
        })
    }
    async ytLiveResults(tms){
        if(!this.ytsr){
            this.ytsr = require('ytsr')
        }
        if(!Array.isArray(tms)){
            tms = global.lists.terms(tms)
        }
        let terms = tms.join(' ')
        terms += ' ('+ global.lang.LIVE +' OR 24h)'
        console.warn('YTSEARCH', terms)
        const filters = await this.ytsr.getFilters(terms)
        const filter = filters.get('Type').get('Video')
        const filters2 = await this.ytsr.getFilters(filter.url)
        const filter2 = filters2.get('Features').get('Live')
        const options = {
            pages: 1,
            gl: global.lang.countryCode.toUpperCase(),
            hl: global.lang.locale,    
            requestOptions: {
                rejectUnauthorized: false,
                transform: (parsed) => {
                    return Object.assign(parsed, {
                        rejectUnauthorized: false
                    })
                }
            }
        }
        const results = await this.ytsr(filter2.url, options)
        results.items = results.items.filter(t => {
            let ytms = global.lists.terms(t.title)
            console.warn('YTSEARCH', tms, ytms)
            return lists.match(tms, ytms, true)
        })
        return results.items.map(t => {
            let icon = t.thumbnails ? t.thumbnails.sortByProp('width').shift().url : undefined
            return {
                name: this.fixYTTitles(t.title),
                icon,
                type: 'stream',
                url: t.url
            }
        })
    }
    async channelsResults(terms){
        let u = global.ucWords(terms)
        this.currentSearch = {
            name: u, 
            url: global.mega.build(u, {terms, mediaType: this.searchMediaType})
        }
        if(!global.lists.loaded()){
            return [global.lists.manager.updatingListsEntry()]
        }
        if(!global.lists.activeLists.length){ // one list available on index beyound meta watching list
            return [global.lists.manager.noListsEntry()]
        }
        let es = await global.channels.search(terms, this.searchInaccurate)
        es = es.map(e => global.channels.toMetaEntry(e))
        let minResultsWanted = (global.config.get('view-size-x') * global.config.get('view-size-y')) - 3
        if(global.config.get('search-youtube') && es.length < minResultsWanted){
            let ys = await this.ytLiveResults(terms).catch(console.error)
            if(Array.isArray(ys)) {
                es.push(...ys.slice(0, minResultsWanted - es.length))
            }
        }
        return global.lists.sort(es)
    }
    isSearching(){
        return global.explorer.currentEntries.some(e => {
            return e.name == global.lang.SEARCH || e.name == global.lang.NEW_SEARCH
        })
    }
    matchTerms(nlc, precision, es){
        let term = false
        if(es.length){
            es.forEach(t => {
                if(nlc.indexOf(t.search_term)!=-1){
                    if(!term || (precision ? term.length < t.search_term.length : term.length > t.search_term.length)){
                        term = t.search_term
                    }
                }
            })
        }
        return term
    }
    termsFromEntry(entry, precision, searchSugEntries){
        return new Promise((resolve, reject) => {
            let nlc = (entry.originalName || entry.name).toLowerCase()
            if(Array.isArray(searchSugEntries)){
                resolve(this.matchTerms(nlc, precision, searchSugEntries))
            } else {
                this.searchSuggestionEntries().then(es => {
                    resolve(this.matchTerms(nlc, precision, es))
                }).catch(e => {
                    console.error(e)
                    resolve(false)
                })
            }
        })
    }
    async searchSuggestionEntries(removeAliases, countryOnly){
        const limit = pLimit(3)
        const ignoreKeywords = ['tv', 'hd', 'sd']
        let ret = {}, locs = await global.lang.getActiveCountries()
        if(countryOnly && locs.includes(global.lang.countryCode)){
            locs = [global.lang.countryCode]
        }
        const tasks = locs.map(loc => {
            return async () => {
                const data = global.cloud.get('searching.'+ loc)
                data.forEach(row => {
                    if(ignoreKeywords.includes(row.search_term)) return
					let count = parseInt(row.cnt)
					if(typeof(ret[row.search_term]) != 'undefined') count += ret[row.search_term]
					ret[row.search_term] = count
                })
            }
        }).map(limit)
        await Promise.allSettled(tasks)
        ret = Object.keys(ret).map(search_term => {
            return {search_term, cnt: ret[search_term]}
        })
        if(countryOnly && !ret.length) {
            return this.searchSuggestionEntries(removeAliases, false)
        }
        if(removeAliases === true){
            ret = this.removeSearchSuggestionsTermsAliasesObject(ret).sortByProp('cnt', true)
        }
        return ret
    }
    removeSearchSuggestionsCheckNames(a, b){
        return (a != b && (a.substr(b.length * -1) == b || (a.indexOf(b) != -1 && a.length <= (b.length + 3))))
    }
    removeSearchSuggestionsGetAliases(o){
        let aliases = {}
        if(o.length){
            let s = o.slice(0)
            if(typeof(s[0]) == 'object'){
                s = s.map(t => {
                    return t.search_term
                })
            }
            s.forEach((k, i) => {
                s.forEach(t => {
                    if(this.removeSearchSuggestionsCheckNames(t, k)){
                        if(typeof(aliases[k]) == 'undefined'){
                            aliases[k] = []
                        }
                        aliases[k].push(t)
                    }
                })
            })
        }
        return aliases
    }
    removeSearchSuggestionsTermsAliases(s){
        if(s.length){
            let aliases = this.removeSearchSuggestionsGetAliases(s)
            s = s.filter(v => {
                let keep = true
                Object.keys(aliases).some(k => {
                    if(aliases[k].indexOf(v) != -1){
                        keep = false
                        return true
                    }
                })
                return keep
            })
        }
        return s
    }
    removeSearchSuggestionsTermsAliasesObject(s){
        if(s.length){
            let aliases = this.removeSearchSuggestionsGetAliases(s), cnts = {}
            s = s.filter((o, i) => {
                let keep = true
                if(typeof(o.cnt) != 'number'){
                    o.cnt = parseInt(o.cnt)
                }
                Object.keys(aliases).some(k => {
                    if(aliases[k].indexOf(o.search_term) != -1){
                        let rem = s.some((t, j) => {
                            if(t.search_term == k){
                                s[j].cnt = parseInt(s[j].cnt) + o.cnt
                                return true
                            }
                        })  
                        if(rem){
                            keep = false
                        }                  
                    }
                })
                return keep
            })
        }
        return s
    }
    defaultTerms(){
        let def = ''
        if(this.currentSearch){
            def = this.currentSearch.name
        }
        return def
    }
    entry(mediaType='live'){
        this.searchMediaType = mediaType
        return {
            name: global.lang.SEARCH,
            details: this.mediaTypeName(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType)
                this.go(value, mediaType)
            },
            value: () => {
                return this.defaultTerms()
            },
            placeholder: global.lang.SEARCH_PLACEHOLDER
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(global.lists.loaded() && global.lists.activeLists.length){
                if(path == global.lang.LIVE){
                    entries.unshift(this.entry('live'))
                } else if(global.lang.CATEGORY_MOVIES_SERIES == path){
                    entries.unshift(this.entry('all'))
                }
            }
            resolve(entries)
        })
    }
}

module.exports = Search
