
const Events = require('events')

class Search extends Events {
    constructor(){
        super()
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
                        fa: 'fas fa-search',
                        icon: global.icons.generate(e.search_term, null)
                    }
                })
                es = es.map(e => global.channels.toMetaEntry(e, false))
                es = global.lists.parentalControl.filter(es)
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
    go(value, mediaType){
        if(value){
            if(!mediaType){
                mediaType = 'all'
            }
            console.log('search-start', value)
            global.ui.emit('set-loading', {name: global.lang.SEARCH}, true, global.lang.SEARCHING)
            global.osd.show(global.lang.SEARCHING, 'fas fa-search spin-x-alt', 'search', 'persistent')
            this.searchMediaType = mediaType
            this[mediaType == 'live' ? 'channelsResults' : 'results'](value).then(rs => {
                if(!rs.length && mediaType == 'live'){
                    return this.go(value, 'all')
                }
                this.emit('search', {query: value})
                if(!global.explorer.path){
                    global.explorer.path = global.lang.SEARCH
                }
                global.explorer.render(this.addFixedEntries(mediaType, rs), global.explorer.path, 'fas fa-search', '/')
            }).catch(global.displayErr).finally(() => {
                global.osd.hide('search')
                global.ui.emit('set-loading', {name: global.lang.SEARCH}, false)
            })
        }
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
        })
        if(this.currentSearch){
            if(mediaType == 'live'){
                es.push({
                    name: global.lang.MORE_RESULTS,
                    details: this.currentSearch.name,
                    type: 'action',
                    fa: 'fas fa-search-plus',
                    action: () => {
                        this.go(this.currentSearch.name, 'all')
                    }
                })
            }
        }
        return es
    }
    results(terms){
        return new Promise((resolve, reject) => {
            let u = global.ucWords(terms)
            this.currentSearch = {
                name: u, 
                icon: global.icons.generate(terms, null), 
                url: global.mega.build(u, {terms, mediaType: this.searchMediaType})
            }
            if(lists.manager.updatingLists){
                return resolve([global.lists.manager.updatingListsEntry()])
            }
            if(!global.activeLists.length){ // one list available on index beyound meta watching list
                return resolve([global.lists.manager.noListsEntry()])
            }
            console.log('will search', terms, {
                partial: this.searchInaccurate, 
                type: this.searchMediaType, 
                typeStrict: this.searchStrict,
                group: this.searchMediaType != 'live'
            })
            global.lists[global.config.get('unoptimized-search') ? 'unoptimizedSearch' : 'search'](terms, {
                partial: this.searchInaccurate, 
                type: this.searchMediaType, 
                typeStrict: this.searchStrict,
                group: this.searchMediaType != 'live'
            }).then(es => {
                es = (es.results && es.results.length) ? es.results : ((es.maybe && es.maybe.length) ? es.maybe : [])
                if(es && es.length){
                    if(global.config.get('show-logos') ){
                        es = global.icons.prepareEntries(es)
                    }
                    es = es.map(e => {
                        e.details = e.groupName || ''
                        return e
                    })
                    this.currentResults = es.slice(0)
                    let len = es.length
                    es.unshift({
                        name: global.lang.AUTO_TUNING,
                        details: u,
                        fa: 'fas fa-play-circle',
                        type: 'action',
                        action: () => {
                            global.streamer.play(this.currentSearch, es)
                        }
                    })
                }
                resolve(es)
            }).catch(reject)
        })
    }
    channelsResults(terms){
        return new Promise((resolve, reject) => {
            let u = global.ucWords(terms)
            this.currentSearch = {
                name: u, 
                icon: global.icons.generate(terms, null), 
                url: global.mega.build(u, {terms, mediaType: this.searchMediaType})
            }
            if(lists.manager.updatingLists){
                return resolve([global.lists.manager.updatingListsEntry()])
            }
            if(!global.activeLists.length){ // one list available on index beyound meta watching list
                return resolve([global.lists.manager.noListsEntry()])
            }
            global.channels.search(terms, this.searchInaccurate).then(resolve).catch(reject)
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
            let nlc = entry.name.toLowerCase()
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
    searchSuggestionEntries(removeAliases){
        return new Promise((resolve, reject) => {
            global.cloud.get('searching').then(es => {
                if(removeAliases === true){
                    es = this.removeSearchSuggestionsTermsAliasesObject(es)
                }
                resolve(es)
            }).catch(err => {
                reject(err)
            })
        })
    }
    removeSearchSuggestionsCheckNames(a, b){
        return (a != b && (a.substr(b.length * -1) == b || (a.indexOf(b) != -1 && a.length <= (b.length + 3))))
    }
    removeSearchSuggestionsGetAliases(o){
        let aliases = {}
        if(o.length){
            s = o.slice(0)
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
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(!lists.manager.updatingLists && global.activeLists.length){
                if(path == global.lang.LIVE){
                    entries.unshift({name: global.lang.SEARCH, fa: 'fas fa-search', type: 'group', renderer: this.entriesLive.bind(this)})
                }
                if(path == global.lang.CATEGORIES){
                    entries.unshift({name: global.lang.SEARCH, fa: 'fas fa-search', type: 'group', renderer: this.entries.bind(this)})
                }
            }
            resolve(entries)
        })
    }
}

module.exports = Search
