
const { EventEmitter } = require('events')

class ListsDiscovery extends EventEmitter {
    constructor(opts = {}) {
        super()
        this.factor = 0.1
        this.key = 'lists-discovery'
        this.opts = Object.assign({
            countries: ['us', 'br'],
            limit: 256
        }, opts)
        this.providers = []
        this.knownLists = []
        this.allowedAtts = ['url', 'name', 'image', 'length', 'health', 'type', 'perceivedHealth', 'perceivedHealthTestCount', 'lastModified'] 
        this.on('registered', () => {
            process.nextTick(() => { // delay a bit to wait for any other registering
                if(this.providers.length > 1 && this.providers.every(p => p[0]._isLoaded)){
                    this.isReady = true
                    this.emit('ready')
                    this.save().catch(console.error)
                } else {
                    this.isReady = false
                }
            })
        })
        this.on('found', () => this.save().catch(console.error))
        const Limiter = require('../limiter')
        this.saver = new Limiter(() => {
            global.storage.set(this.key, this.knownLists, {
                permanent: true,
                expiration: true
            })
        }, 10000)
        this.restore().catch(console.error);
        global.rendererReady(() => {
            const PublicListsProvider = require('./providers/public-lists')
            const CommunityListsProvider = require('./providers/community-lists')
            const CommunityListsIPTVOrgProvider = require('./providers/community-lists-iptv-org');
            [
                [new PublicListsProvider(), 'public'],
                [new CommunityListsProvider(), 'community'],
                [new CommunityListsIPTVOrgProvider(), 'community']
            ].forEach(row => this.register(...row))
            global.menu.addFilter(this.hook.bind(this))
        })
    }
    async restore(){
        const data = await global.storage.get(this.key).catch(console.error)
        Array.isArray(data) && this.add(data)
    }
    async reset(){
        this.knownLists = []
        await this.save()
        await this.update()
        await this.save()
    }
    async save(){
        this.saver.call()
    }
    register(provider, type){
        provider._isLoaded = false
        provider.type = type
        this.providers.push([provider, type])
        provider.discovery(lists => this.add(lists)).catch(console.error).finally(() => {
            provider._isLoaded = true
            this.emit('registered')
        })
    }
    async update(provider, type){
        for(const provider of this.providers) {
            provider[0]._isLoaded = false
            await provider[0].discovery(lists => this.add(lists)).catch(console.error).finally(() => {
                provider[0]._isLoaded = true
                this.emit('registered')
            })
        }
    }
    ready(){
        return new Promise(resolve => {
            if(this.isReady){
                return resolve()
            }
            this.once('ready', resolve)
        })
    }
    async get(amount=20) {
        await this.ready()
        this.sort()
        const active = {
            public: global.config.get('public-lists'),
            community: global.config.get('communitary-mode-lists-amount') > 0
        }
        return this.domainCap(this.knownLists.filter(list => active[list.type]), amount)
    }
	domain(u){
		if(u && u.indexOf('//')!=-1){
			var domain = u.split('//')[1].split('/')[0]
			if(domain == 'localhost' || domain.indexOf('.') != -1){
				return domain
			}
		}
		return ''
	}
    domainCap(lists, limit){
        let currentLists = lists.slice(0)
        const ret = [], domains = {}, quota = 1 // limit each domain up to 20% of selected links, except if there are no other domains enough
        while(currentLists.length && ret.length < limit) {
            currentLists = currentLists.filter(l => {
                const dn = this.domain(l.url)
                if(typeof(domains[dn]) == 'undefined') {
                    domains[dn] = 0
                }
                if(domains[dn] < quota) {
                    domains[dn]++
                    ret.push(l)
                    return false
                }
                return true
            })
            Object.keys(domains).forEach(dn => domains[dn] = 0) // reset counts and go again until fill limit
        }
        return ret.slice(0, limit)
    }
    details(url, key) {
        const list = this.knownLists.find(l => l.url === url)
        if(list) {
            if(key) {
                return list[key]
            }
            return list
        }
    }
    add(lists) {
        const now = new Date().getTime() / 1000
        const aYear = 365 * (30 * 24) // aprox
        const oneYearAgo = now - aYear, newOnes = []
        Array.isArray(lists) && lists.forEach(list => {
            if(!list || !list.url) return
            const existingListIndex = this.knownLists.findIndex(l => l.url === list.url)
            if (existingListIndex === -1) {
                this.knownLists.push(Object.assign({
                    health: -1,
                    perceivedHealth: 0,
                    perceivedHealthTestCount: 0
                }, {
                    ...this.cleanAtts(list),
                    lastModified: Math.max(oneYearAgo, list.lastModified || 0)
                }))
                newOnes.push(list.url)
            } else {
                this.assimilate(existingListIndex, this.cleanAtts(list))
            }
        })
        if (newOnes.length) {
            this.alignKnownLists()
            this.emit('found', newOnes)
        }
    }
    cleanAtts(list){
        Object.keys(list).forEach(k => {
            if(!this.allowedAtts.includes(k)){
                delete list[k]
            }
        })
        return list
    }
    assimilate(existingListIndex, list){
        const existingList = this.knownLists[existingListIndex]
        const health = this.averageHealth({
            health: existingList.health,
            perceivedHealth: list.health
        }) // average health from both
        if(list.type == 'community' && this.knownLists[existingListIndex].type == 'public') {
            list.type = 'public' // prefer it as public list
        }
        this.knownLists[existingListIndex] = {
            ...list,
            health,
            name: existingList.name || list.name, // trusting more on own info
            image: existingList.image || list.image,
            countries: this.mergeCountries(existingList, list),
            perceivedHealth: existingList.perceivedHealth, // perceived health is personal, should not be merged
            perceivedHealthTestCount: existingList.perceivedHealthTestCount,
            lastModified: list.lastModified
        }
    }
    mergeCountries(a, b) { // TODO: implement here some capping to avoid countries overflow
        const c = a.countries || []
        return c.concat((b.countries || []).filter(g => !c.includes(g)))
    }
    reportHealth(sourceListUrl, success) {
        return this.knownLists.some((list, i) => {
            if(list.url === sourceListUrl) {
                const value = success ? 1 : 0
                if(typeof(list.perceivedHealthTestCount) != 'number'){
                    list.perceivedHealthTestCount = 0
                }
                if(list.perceivedHealthTestCount < (1 / this.factor)){
                    list.perceivedHealthTestCount++
                }
                if(typeof(list.perceivedHealth) == 'number' && list.perceivedHealthTestCount > 1){
                    this.knownLists[i].perceivedHealth = ((list.perceivedHealth * (list.perceivedHealthTestCount - 1)) + value) / list.perceivedHealthTestCount
                } else {
                    this.knownLists[i].perceivedHealth = value
                }
                this.save().catch(console.error)
                return true
            }
        })
    }
    averageHealth(list) {
        let health = 0, values = [list.health, list.perceivedHealth].filter(n => {
            return typeof(n) == 'number' && n >= 0 && n <= 1
        })
        if(values.length) {
            values.forEach(v => health += v)
            health /= values.length
        }
        return health
    }
    sort() {
        this.knownLists = this.knownLists.map(a => {
            a.averageHealth = this.averageHealth(a)
            return a
        })
        this.knownLists.sort((a, b) => b.averageHealth - a.averageHealth)
    }
    alignKnownLists() {
        if (this.knownLists.length > this.opts.limit) {
            this.sort()
            this.knownLists.splice(this.opts.limit)
        }
    }
    async hook(entries, path){
        if(path.split('/').pop() == global.lang.MY_LISTS) {
            entries.push({
                name: global.lang.INTERESTS,
                details: global.lang.SEPARATE_WITH_COMMAS, 
                type: 'input',
                fa: 'fas fa-edit',
                action: (e, v) => {
                    if(v !== false && v != global.config.get('interests')){
                        global.config.set('interests', v)
                        global.renderer.emit('ask-restart')
                    }
                },
                value: () => {
                    return global.config.get('interests')
                },
                placeholder: global.lang.INTERESTS_HINT,
                multiline: true,
                safe: true
            })
        }
        return entries
    }
    async interests() {
        const badTerms = ['m3u8', 'ts', 'mp4', 'tv', 'channel']
        const bookmarks = require('../bookmarks')
        const search = require('../search')
        const history = require('../history')
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
        let bterms = bookmarks.get()
        if(bterms.length){ // bookmarks terms
            bterms = bterms.slice(-24)
            bterms = bterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(bterms)
        }
        let sterms = await search.history.terms()
        if(sterms.length){ // searching terms history
            sterms = sterms.slice(-24)
            sterms = sterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(sterms)
        }
        let hterms = history.get()
        if(hterms.length){ // user history terms
            hterms = hterms.slice(-24)
            hterms = hterms.map(e => channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(hterms)
        }
        addTerms(await global.channels.keywords())
        const max = Math.max(...terms.map(t => t.score))
        let cterms = global.config.get('interests')
        if(cterms){ // user specified interests
            const lists = require('../lists')
            cterms = lists.terms(cterms, true).filter(c => c[0] != '-')
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
}

module.exports = new ListsDiscovery()
