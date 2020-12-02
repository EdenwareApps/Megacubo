
const Events = require('events')

class Search extends Events {
    constructor(){
        super()
        this.emptyEntry = {name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty'}
        this.searchMediaType = null
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
            let ntries = this.fixedEntries('live')
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
                es = ntries.concat(es)
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
            resolve(this.fixedEntries('all'))
        })
    }
    go(value, mediaType){
        if(value){
            console.log('search-start', value)
            global.ui.emit('set-loading', {name: global.lang.SEARCH}, true, global.lang.SEARCHING)
            global.osd.show(global.lang.SEARCHING, 'fas fa-search spin-x-alt', 'search', 'persistent')
            this[mediaType == 'live' ? 'channelsResults' : 'results'](value).then(rs => {
                this.emit('search', {query: value})
                this.currentEntries = this.fixedEntries(mediaType).concat(rs)
                global.explorer.render(this.currentEntries, global.explorer.path, 'fas fa-search', '/')
            }).catch(global.displayErr).finally(() => {
                global.osd.hide('search')
                global.ui.emit('set-loading', {name: global.lang.SEARCH}, false)
            })
        }
    }
    refresh(){
        if(this.currentSearch){
            this.go(this.currentSearch.name)
        }
    }
    searchOptionsEntry(mediaType){
        return {
            name: global.lang.OPTIONS, 
            type: 'group', 
            fa: 'fas fa-cog', 
            renderer: () => {
                return new Promise((resolve, reject) => {
                    let opts = [
                        {name: global.lang.INCLUDE_INACCURATE_RESULTS, type: 'check', checked: () => {
                            return this.searchInaccurate
                        }, action: (e, value) => {
                            this.searchInaccurate = value
                            this.refresh()
                        }},
                        {name: global.lang.INCLUDE_RESULTS_WITH_UNIDENTIFIED_TYPE, type: 'check', checked: () => {
                            return !this.searchStrict
                        }, action: (e, value) => {
                            this.searchStrict = !value
                            this.refresh()
                        }}
                    ]
                    if(!mediaType || mediaType == 'all'){
                        opts.unshift({
                            name: global.lang.SEARCH_FOR, 
                            type: 'select', 
                            fa: 'fas fa-search-plus', 
                            renderer: () => {
                                return new Promise((resolve, reject) => {
                                    let es = [
                                        {
                                            name: global.lang.LIVE, 
                                            type: 'action', 
                                            value: 'live',
                                            action: (data) => {
                                                this.searchMediaType = data.value
                                                this.refresh()
                                            }
                                        },
                                        {
                                            name: global.lang.VIDEOS, 
                                            type: 'action', 
                                            value: 'video',
                                            action: (data) => {
                                                this.searchMediaType = data.value
                                                this.refresh()
                                            }
                                        },
                                        {
                                            name: global.lang.AUDIOS, 
                                            type: 'action', 
                                            value: 'audio',
                                            action: (data) => {
                                                this.searchMediaType = data.value
                                                this.refresh()
                                            }
                                        },
                                        {
                                            name: global.lang.ALL, 
                                            type: 'action', 
                                            value: null,
                                            action: (data) => {
                                                this.searchMediaType = data.value
                                                this.refresh()
                                            }
                                        }
                                    ]
                                    resolve(es.map(e => {
                                        e.selected = e.value == this.searchMediaType
                                        return e
                                    }))
                                })
                            }
                        })
                    }
                    if(this.currentSearch){
                        let bookmarking = Object.assign({}, this.currentSearch)
                        if(global.bookmarks.has(bookmarking)){
                            opts.unshift({
                                type: 'action',
                                fa: 'fas fa-star-half',
                                name: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS),
                                details: this.currentSearch.name,
                                action: () => {
                                    global.bookmarks.remove(bookmarking)
                                    global.explorer.refresh()
                                }
                            })
                        } else {
                            opts.unshift({
                                type: 'action',
                                fa: 'fas fa-star',
                                name: global.lang.ADD_TO.format(global.lang.BOOKMARKS),
                                details: this.currentSearch.name,
                                action: () => {
                                    global.bookmarks.add(bookmarking)
                                    global.explorer.refresh()
                                }
                            })
                        } 
                        if(this.currentResults.length && !global.config.get('auto-testing')) {
                            opts.unshift({
                                name: global.lang.TEST_STREAMS,
                                details: global.lang.X_BROADCASTS.format(this.currentResults.length),
                                fa: 'fas fa-satellite-dish',
                                type: 'action',
                                action: () => {
                                    global.explorer.back()
                                    global.streamState.test(this.currentResults)
                                }
                            })
                        }
                    }
                    resolve(opts)
                })
            }
        }
    }
    fixedEntries(mediaType){
        let entries = [
            {
                name: global.lang.SEARCH,
                type: 'input',
                fa: 'fas fa-search',
                action: (e, value) => {
                    this.go(value, mediaType)
                },
                value: () => {
                    return this.defaultTerms()
                },
                placeholder: global.lang.SEARCH_PLACEHOLDER
            }
        ]
        if(mediaType != 'live'){
            entries.push(this.searchOptionsEntry(mediaType))
        }
        return entries
    }
    results(terms){
        return new Promise((resolve, reject) => {
            let u = global.ucWords(terms)
            this.currentSearch = {
                name: u, 
                icon: global.icons.generate(terms, null), 
                url: global.mega.build(u, {terms, mediaType: this.searchMediaType})
            }
            global.lists.search(terms, {
                partial: this.searchInaccurate, 
                type: this.searchMediaType, 
                typeStrict: this.searchStrict
            }).then(es => {
                es = (es.results && es.results.length) ? es.results : ((es.maybe && es.maybe.length) ? es.maybe : [])
                if(!es || !es.length){
                    es = [this.emptyEntry]
                } else {
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
        return ''
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(!global.updatingLists && global.activeLists.length){
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
