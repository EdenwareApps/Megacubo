import menu from '../menu/menu.js'
import lang from "../lang/lang.js"
import storage from '../storage/storage.js'
import mega from "../mega/mega.js"
import config from "../config/config.js"
import { ts2clock, time } from "../utils/utils.js"
import { EventEmitter } from 'events'
import PQueue from 'p-queue'
import renderer from '../bridge/bridge.js'
import fs from 'fs'

class Tags extends EventEmitter{
    constructor() {
        super()
        this.caching = {programmes: {}, trending: {}}
        this.defaultTagsCount = 1024
        this.filterTagsRegex = new RegExp('[a-z]', 'i')
        this.resetQueue = new PQueue({concurrency: 1})
        global.channels.history.epg.on('change', () => this.historyUpdated(true))
        global.channels.watching.on('update', () => this.trendingUpdated(true))
        global.channels.ready().then(() => this.reset()).catch(console.error)
    }
    async reset() {
        if(this.resetQueue.size) {
            return await this.resetQueue.onIdle()
        }
        return await this.resetQueue.add(async () => {
            await this.historyUpdated(false)
            await this.trendingUpdated(true)
        })
    }
    filterTag(tag) {
        return tag && tag.length > 2 && (tag.length > 4 || tag.match(this.filterTagsRegex)) // not a integer
    }
    filterTags(tags) {
        if(Array.isArray(tags)) {
            return tags.filter(t => this.filterTag(t))
        } else {
            for(const k in tags) {
                if(!this.filterTag(k)) {
                    delete tags[k]
                }
            }
            return tags
        }
    }
    prepare(data, limit) {
        const maxWords = 3
        return Object.fromEntries(
            Object.entries(data)
                .filter(([key, value]) => key.split(' ').length <= maxWords)
                .sort(([, valueA], [, valueB]) => valueB - valueA) 
                .slice(0, limit)
        )
    }
    async historyUpdated(emit) {
        const data = {}
        global.channels.history.epg.data.slice(-6).forEach(row => {
            const name = row.originalName || row.name
            const category = global.channels.getChannelCategory(name)
            if (category) {
                if (typeof (data[category]) == 'undefined') {
                    data[category] = 0
                }
                data[category] += row.watched.time
            }
        })
        const pp = Math.max(...Object.values(data)) / 100
        Object.keys(data).forEach(k => data[k] = data[k] / pp)
        
        const data0 = {}
        for(const row of global.channels.history.epg.data.slice(-6)) {
            const cs = row.watched ? row.watched.categories : []
            const name = row.originalName || row.name
            const cat = global.channels.getChannelCategory(name)
            if (cat && !cs.includes(cat)) {
                cs.push(cat)
            }
            if (row.groupName && !cs.includes(row.groupName)) {
                cs.push(row.groupName)
            }            
            cs.length && [...new Set(cs)].forEach(category => {
                if (category) {
                    let lc = category.toLowerCase()
                    if (typeof (data0[lc]) == 'undefined') {
                        data0[lc] = 0
                    }
                    data0[lc] += row.watched ? row.watched.time : 180
                }
            })
        }
        const pp0 = Math.max(...Object.values(data0)) / 100
        Object.keys(data0).forEach(k => data0[k] = data0[k] / pp0)
        
        for(const k in data) {
            if(data0[k]) {
                data0[k] = Math.max(data0[k], data[k])
            } else {
                data0[k] = data[k]
            }
        }
        this.caching.programmes = await this.expand(this.filterTags(data0))
        emit && this.emit('updated')
    }
    async trendingUpdated(emit) {
        let watchingPromise = true
        if(!global.channels.watching.currentRawEntries) {
            watchingPromise = global.channels.watching.getRawEntries()
        }
        let searchPromise = this.searchSuggestionEntries || global.channels.search.searchSuggestionEntries().then(data => this.searchSuggestionEntries = data)
        await Promise.allSettled([watchingPromise, searchPromise]).catch(console.error)

        const map = {}
        if(Array.isArray(global.channels.watching.currentRawEntries)) {
            const data = global.channels.watching.currentRawEntries
            for(const e of data) {
                const terms = global.channels.entryTerms(e)
                terms.forEach(t => {
                    if(t.startsWith('-')) return
                    if(typeof(map[t]) == 'undefined') {
                        map[t] = 0
                    }
                    if(typeof(map[t]) == 'number') { // do not mess object methods
                        map[t] += e.users
                    }
                })
            } 
        }

        if(Array.isArray(this.searchSuggestionEntries)) {
            console.log('trendingUpdated() 1')
            for(const e of this.searchSuggestionEntries) {
                const t = e.search_term
                if(t.startsWith('-')) continue
                if(typeof(map[t]) == 'undefined') {
                    map[t] = 0
                }
                if(typeof(map[t]) == 'number') { // do not mess object methods
                    map[t] += e.cnt
                }
            }
        }

        console.log('trendingUpdated() 2')
        const pp = Math.max(...Object.values(map)) / 100
        Object.keys(map).forEach(k => map[k] = map[k] / pp)
        this.caching.trending = await this.expand(this.filterTags(map))
        emit && this.emit('updated')
    }
    async expand(tags) {
        let err, additionalTags = {}            
        const limit = this.defaultTagsCount
        const additionalLimit = limit - Object.keys(tags).length
        console.log('rec.tags() 1')
        const expandedTags = await global.lists.epgExpandRecommendations(Object.keys(tags)).catch(e => err = e)
        console.log('rec.tags() 2')
        if (!err && expandedTags) {
            Object.keys(expandedTags).forEach(term => {
                const score = tags[term]
                expandedTags[term].forEach(t => {
                    if (tags[t])
                        return
                    if (typeof (additionalTags[t]) == 'undefined') {
                        additionalTags[t] = 0
                    }  
                    additionalTags[t] += score / 2
                })
            })
            additionalTags = this.prepare(this.filterTags(additionalTags), additionalLimit)
            Object.assign(tags, additionalTags)
        }
        return tags
    }
    async get(limit) {
        if(typeof(limit) != 'number') {
            limit = this.defaultTagsCount
        }
        console.log('rec.tags() 0')
        const programmeTags = this.prepare(this.caching.programmes, limit)
        if (Object.keys(programmeTags).length < limit) {
            console.log('rec.tags() 3')
            Object.assign(programmeTags, this.caching.trending)
        }
        console.log('rec.tags() 4')
        return this.prepare(programmeTags, limit)
    }
}

class Recommendations extends EventEmitter {
    constructor() {
        super()
        this.readyState = 0
        this.tags = new Tags()
        this.queue = new PQueue({concurrency: 4})
        this.updaterQueue = new PQueue({concurrency: 1})
        this.channelsLoaded = false
        this.epgLoaded = false
        this.someListLoaded = false
        this.listsLoaded = false
        this.cacheKey = 'epg-suggestions-featured-1'
        renderer.ready(() => {
            this.updateIntervalSecs = global.cloud.expires.watching || 300
            this.tags.on('updated', () => this.scheduleUpdate())
            global.lists.on('list-loaded', () => {
                if(!this.someListLoaded && this.readyState < 4) {
                    this.someListLoaded = true
                    this.scheduleUpdate()
                }
            })
            global.channels.on('epg-loaded', async () => {
                this.epgLoaded || storage.delete(this.cacheKey)
                this.epgLoaded = true
                this.scheduleUpdate()
            })
            global.lists.manager.waitListsReady().then(async () => {
                this.listsLoaded = true
                this.scheduleUpdate()
            }).catch(console.error)
        })
    }
    async scheduleUpdate() {
        return this.queue.size || this.updaterQueue.add(async () => {
            await this.update().catch(console.error)
        })
    }
    /*
    async validateChannels(data) {
        let chs = {}
        Object.keys(data).forEach(ch => {
            let channel = global.channels.isChannel(ch)
            if (channel) {
                if (!chs[channel.name]) {
                    chs[channel.name] = global.channels.epgPrepareSearch(channel)
                }
            }
        })
        let alloweds = []
        await Promise.allSettled(Object.keys(chs).map(async name => {
            return this.queue.add(async () => {
                const channelMappedTo = await global.lists.epgFindChannel(chs[name])
                if (channelMappedTo)
                    alloweds.push(channelMappedTo)
            })
        }))
        Object.keys(data).forEach(ch => {
            if (!alloweds.includes(ch)) {
                delete data[ch]
            }
        })
        return data
    }
    */
    processEPGRecommendations(data) {
        const results = [], already = new Set()
        Object.keys(data).forEach(ch => {
            let channel = global.channels.isChannel(ch)
            if (channel) {
                if(already.has(channel.name)) return
                already.add(channel.name)
                Object.keys(data[ch]).forEach(start => {
                    results.push({
                        channel,
                        labels: data[ch][start].c,
                        programme: data[ch][start],
                        start: parseInt(start),
                        och: ch
                    })
                })
            }
        })
        return results
    }
    async get(tags, amount=128) {
        const now = (Date.now() / 1000)
        const timeRange = 3 * 3600
        const timeRangeP = timeRange / 100
        const until = now + timeRange
        if(!tags) {
            tags = await this.tags.get()
        }
        let data = await global.lists.epgRecommendations(tags, until, amount * 4)

        const interests = new Set()
        global.channels.history.get().some(e => {
            const c = global.channels.isChannel(e)
            if(c) {
                interests.add(c.name)
                return true
            }
        })
        if(channels.watching.currentEntries && channels.watching.currentEntries.length) {
            global.channels.watching.currentEntries.some(e => {
                if(e.type != 'select') return
                interests.add(e.originalName || e.name)
                return true
            })
        }
        
        // console.log('suggestions.get', tags)
        let maxScore = 0, results = this.processEPGRecommendations(data)
        results = results.map(r => {
            let score = 0
            
            // bump programmes by categories amount and relevance
            r.programme.c.forEach(l => {
                if (tags[l]) {
                    score += tags[l]
                }
            })
            
            // bump programmes starting earlier
            let remainingTime = r.start - now
            if (remainingTime < 0) {
                remainingTime = 0
            }
            score += 100 - (remainingTime / timeRangeP)

            // bump+ last watched and most trending channels
            if(interests.has(r.channel.name)) {
                score += 500
            }

            r.score = score
            if (score > maxScore) maxScore = score
            return r
        })

        // remove repeated programmes
        console.log('RGET RESULTS', results.length) 
        let nresults = [], already = new Set()
        results = results.sortByProp('score', true) // sort before equilibrating
        
        for(const r of results) {
            if (already.has(r.programme.t)) continue
            already.add(r.programme.t)
            const c = global.channels.epgPrepareSearch(r.channel)
            const valid = await global.lists.epgValidateChannelProgramme(c, r.start, r.programme.t).catch(console.error)
            valid === true && nresults.push(r)
        }
        console.log('RGET RESULTS', results.length) 
        results = nresults
        nresults = []
        
        console.log('RGET RESULTS', results.length) 

        // equilibrate categories presence
        /* not yet mature piece of code, needs more testing 
        if (results.length > amount) {
            let total = 0
            const quotas = {}
            Object.values(tags).forEach(v => total += v)
            Object.keys(tags).forEach(k => {
                quotas[k] = Math.max(1, Math.ceil((tags[k] / total) * amount))
            })
            while (nresults.length < amount) {
                let added = 0
                const lquotas = Object.assign({}, quotas)
                nresults.push(...results.filter((r, i) => {
                    if (!r) return
                    for (const cat of r.programme.c) {
                        if (lquotas[cat] > 0) {
                            added++
                            lquotas[cat]--
                            results[i] = null
                            return true
                        }
                    }
                }))
                //console.log('added', added, nresults.length)
                if (!added) break
            }
            if (nresults.length < amount) {
                nresults.push(...results.filter(r => r).slice(0, amount - nresults.length))
            }
            results = nresults
        }
        console.log('RGET RESULTS', results.length) 
        */
       
        // transform scores to percentages
        let ppScore = maxScore / 100
        results.forEach((r, i) => {
            results[i].st = Math.min(r.start < now ? now : r.start)
            results[i].score /= ppScore
        })

        return results.sortByProp('score', true).slice(0, amount).sortByProp('st').map(r => {
            const entry = global.channels.toMetaEntry(r.channel)
            entry.programme = r.programme
            entry.name = r.programme.t
            entry.originalName = r.channel.name
            if (entry.rawname)
                entry.rawname = r.channel.name
            entry.details = ''
            if (r.programme.i) {
                entry.icon = r.programme.i
            }
            if (r.start < now) {
                entry.details += '<i class="fas fa-play-circle"></i> ' + lang.LIVE
            } else {
                entry.details += '<i class="fas fa-clock"></i> ' + ts2clock(r.start)
                entry.type = 'action'
                entry.action = () => {
                    global.channels.epgProgramAction(r.start, r.channel.name, r.programme, r.channel.terms)
                }
            }
            entry.och = r.och
            entry.details += ' &middot; ' + r.channel.name
            return entry
        })
    }
    hasEPG() {
        return global.activeEPG && global.channels.loadedEPG
    }
    async hasEPGChannel(ch, withIcon) {     
        const terms = global.channels.entryTerms(ch).filter(t => !t.startsWith('-'))
        const results = await global.lists.epgSearchChannel(terms, 99)
        return Object.keys(results).some(name => {
            if(results[name]) {
                const keys = Object.keys(results[name])
                if(keys.length) {
                    if(!withIcon || (results[name][keys[0]].i && results[name][keys[0]].i.length > 10)) {
                        return true
                    }
                }
            }
        })
    }
    async getChannels(amount=5, _excludes=[]) {
        const excludes = new Set(_excludes)
        const results = [], epgAvailable = this.hasEPG()
        const isChannelCache = {}, validateCache = {}, hasEPGCache = {}
        const channel = e => {
            const name = typeof(e) == 'string' ? e : (e.originalName || e.name)
            if (typeof(isChannelCache[name]) == 'undefined') {
                isChannelCache[name] = false
                if (name && !excludes.has(name)) {
                    const e = global.channels.isChannel(name)
                    if (e) {
                        isChannelCache[name] = e
                    }
                }
            }
            return isChannelCache[name]
        }
        const validate = async e => {
            const name = typeof(e) == 'string' ? e : (e.originalName || e.name)
            if (typeof(validateCache[name]) == 'undefined') {
                validateCache[name] = false
                if (name && !excludes.has(name)) {
                    const c = channel(e)
                    if (c) {
                        const result = await global.lists.has([{ name: c.name, terms: c.terms }])
                        if(result[c.name]) {
                            validateCache[name] = c
                            if(name != c.name) {
                                validateCache[c.name] = c
                            }
                            return c // return here to prevent name x c.name confusion
                        }
                    }
                }
            }
            return validateCache[name]
        }
        const hasEPG = async (e, icon) => {
            if(!epgAvailable) return true
            const name = typeof(e) == 'string' ? e : (e.originalName || e.name)
            const key = name + (icon ? '-icon' : '')
            if (typeof(hasEPGCache[key]) == 'undefined') {
                let err
                hasEPGCache[key] = await this.hasEPGChannel(e, icon).catch(e => err = e)
                if(err) {
                    hasEPGCache[key] = false
                }
            }
            return hasEPGCache[key]
        }
        const watchingIndex = (global.channels.watching.currentEntries || []).map(n => channel(n)).filter(n => n)
        for (const e of watchingIndex) {
            const valid = await validate(e).catch(console.error)
            if (valid !== false) {
                if(await hasEPG(valid, true)) {
                    results.push(valid)
                    if (results.length >= amount)
                        break
                }
            }
        }
        if (results.length < amount) {
            let maybes = []
            for (const name of this.shuffledIndex()) {
                const valid = await validate(name).catch(console.error)
                if (valid !== false) {
                    if(await hasEPG(valid, true)) {
                        results.push(valid)
                        if (results.length == amount)
                            break
                    } else {
                        maybes.push(valid)
                    }
                }
            }
            if (results.length < amount) {
                results.push(...maybes.slice(0, amount - results.length))
            }
        }
        return results.map(e => {
            return global.channels.toMetaEntry({
                name: e.name,
                url: mega.build(e.name, { mediaType: 'live', terms: e.terms })
            })
        })
    }
    shuffle(arr) {
        const names = global.channels.history.get().map(e => (e.originalName || e.name))
        if(global.channels.watching.currentRawEntries) {
            names.push(...global.channels.watching.currentRawEntries.map(e => e.name))
        }
        const known = new Set(names)
        return arr.map(value => {
            const sort = known.has(value) ? 1 : (Math.random() * 0.9)
            return {value, sort}
        }).sortByProp('sort', true).map(({value}) => value)
    }
    shuffledIndex() {
        const index = global.channels.channelList.channelsIndex
        const hash = Object.keys(global.channels.channelList.channelsIndex).join('|') +':'+ typeof(global.channels.watching.currentRawEntries)
        if(!this._shuffledIndex || this._shuffledIndex.hash != hash) { // shuffle once per run on each channelList
            this._shuffledIndex = {hash, index: this.shuffle(Object.keys(index))}
        }
        return this._shuffledIndex.index
    }
    async entries(vod) {
        let es
        if(vod === true) {
            es = await global.lists.multiSearch(await this.tags.get(), {limit: 256, type:'video', group: false, typeStrict: true})
        } else {
            es = await this.get(null, 256).catch(console.error)
        }
        if (!Array.isArray(es)) {
            es = []
        }
        if (!es.length) {
            if (global.activeEPG || config.get('epg-' + lang.locale)) {
                es.push({
                    name: lang.NO_RECOMMENDATIONS_YET,
                    type: 'action',
                    fa: 'fas fa-info-circle',
                    class: 'entry-empty',
                    action: async () => {
                        const ret = await menu.dialog([
                            { template: 'question', text: lang.NO_RECOMMENDATIONS_YET, fa: 'fas fa-info-circle' },
                            { template: 'message', text: lang.RECOMMENDATIONS_INITIAL_HINT },
                            { template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' },
                            { template: 'option', text: lang.EPG, id: 'epg', fa: 'fas fa-th' }
                        ])
                        if (ret == 'epg') {
                            if (paths.ALLOW_ADDING_LISTS) {
                                menu.open(lang.MY_LISTS + '/' + lang.EPG).catch(console.error)
                            } else {
                                menu.open(lang.OPTIONS + '/' + lang.MANAGE_CHANNEL_LIST + '/' + lang.EPG).catch(console.error)
                            }
                        }
                    }
                })
            } else {
                es.push({
                    name: lang.EPG_DISABLED,
                    type: 'action',
                    fa: 'fas fa-times-circle',
                    class: 'entry-empty',
                    action: async () => {
                        const path = lang.MY_LISTS + '/' + lang.EPG
                        await menu.open(path)
                    }
                })
            }
        } else if (es.length <= 5) {
            es.push({
                name: lang.IMPROVE_YOUR_RECOMMENDATIONS,
                type: 'action',
                fa: 'fas fa-info-circle',
                class: 'entry-empty',
                action: async () => {
                    await menu.dialog([
                        { template: 'question', text: lang.IMPROVE_YOUR_RECOMMENDATIONS, fa: 'fas fa-thumbs-up' },
                        { template: 'message', text: lang.RECOMMENDATIONS_IMPROVE_HINT },
                        { template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' }
                    ])
                }
            })
        }
        if (vod !== true && es.length) {
            es.push({
                name: lang.WATCHED,
                fa: 'fas fa-history',
                type: 'group',
                renderer: global.channels.history.epg.historyEntries.bind(global.channels.history.epg)
            })
        }
        return es
    }
    async update() {
        const time = () => Date.now() / 1000
        const amount = 36, start = time()
        const uid = parseInt(Math.random() * 10000)
        let es = [], tmpkey = this.cacheKey
        if(global.channels && global.channels.channelList) {
            tmpkey += global.channels.channelList.key
        }
        let tags, channels
        console.log('recommentations.update() '+ uid +' 3 '+ (time() - start) +'s')
        es = await storage.get(this.cacheKey).catch(console.error)
        console.log('recommentations.update() '+ uid +' 4 '+ (time() - start) +'s')
        if (es && es.length) {
            es = es.map(e => global.channels.toMetaEntry(e))
        } else {
            if(!this.featuredEntriesCache || !this.featuredEntriesCache.data.length) {
                channels = await this.getChannels(amount, []) // weak recommendations for now, as EPG may take some time to process
                if(channels.length) {
                    channels = channels.map(e => global.channels.toMetaEntry(e))
                    channels = await global.channels.epgChannelsAddLiveNow(channels, false)
                    if(!this.featuredEntriesCache || this.featuredEntriesCache.data.length < channels.length) {
                        this.featuredEntriesCache = {data: channels, key: tmpkey}
                        if(this.readyState < 2) {
                            global.menu.updateHomeFilters()
                            this.readyState = 2
                        }
                    }
                }
            }
            console.log('recommentations.update() '+ uid +' 4.4 '+ (time() - start) +'s')
            tags = await this.tags.get()
            console.log('recommentations.update() '+ uid +' 4.5 '+ (time() - start) +'s')
            es = await this.get(tags, 128).catch(console.error)
            console.log('recommentations.update() '+ uid +' 4.6 '+ (time() - start) +'s')
            if (Array.isArray(es) && es.length) {
                if (es.some(n => n.programme.i)) { // prefer entries with icons
                    es = es.filter(n => n.programme.i)
                }
                storage.set(this.cacheKey, es, {ttl: this.updateIntervalSecs})
            } else es = []
        }
        console.log('recommentations.update() '+ uid +' 5 '+ (time() - start) +'s')
        if (es.length < amount) {
            channels = await this.getChannels(amount - es.length, es.map(e => (e.originalName || e.name)))
            channels = channels.map(e => global.channels.toMetaEntry(e))
            channels = await global.channels.epgChannelsAddLiveNow(channels, false)
            es.push(...channels)
            console.log('recommentations.update() '+ uid +' 6 '+ (time() - start) +'s '+ channels.length)
        }

        /*
        console.log('recommentations.update() '+ uid +' 7 '+ (time() - start) +'s')
        if (es.length < amount) {
            if(tags) {
                tags = this.tags.prepare(tags, 24)
            } else {
                console.log('recommentations.update() '+ uid +' 7.5 '+ (time() - start) +'s')
                tags = await this.tags.get(24)
            }
            console.log('recommentations.update() '+ uid +' 8 '+ (time() - start) +'s, '+ Object.keys(tags).length +' tags') 
            const nwes = await global.lists.multiSearch(tags, {
                group: false,
                limit: amount - es.length,
                type: 'video',
                typeStrict: true
            })
            es.push(...nwes)
            console.log('recommentations.update() '+ uid +' 9 '+ (time() - start) +'s')
        }
        */

        console.log('recommentations.update() '+ uid +' 10 '+ (time() - start) +'s '+ es.length)
        if(!this.featuredEntriesCache || this.featuredEntriesCache.data.length <= es.length || this.featuredEntriesCache.key != tmpkey) {
            this.featuredEntriesCache = {
                data: es,
                key: tmpkey
            }
            global.menu.updateHomeFilters()
        }       
        this.readyState = (this.channelsLoaded && this.epgLoaded && this.listsLoaded) ? 4 : 3
    }
    async featuredEntries(amount=5) {
        if(amount < 1) return []
        return (this.featuredEntriesCache && this.featuredEntriesCache.data) ? this.featuredEntriesCache.data.slice(0, amount) : []
    }
    async hook(entries, path) {
        if (path == lang.LIVE) {
            const entry = {
                name: lang.RECOMMENDED_FOR_YOU,
                fa: 'fas fa-solid fa-thumbs-up',
                type: 'group',
                details: lang.LIVE,
                hookId: 'recommendations',
                renderer: this.entries.bind(this, false)
            }
            if (entries.some(e => e.hookId == entry.hookId)) {
                entries = entries.filter(e => e.hookId != entry.hookId)
            }
            entries.unshift(entry)
        } else if (path == lang.CATEGORY_MOVIES_SERIES) {
            const entry = {
                name: lang.RECOMMENDED_FOR_YOU,
                fa: 'fas fa-solid fa-thumbs-up',
                type: 'group',
                details: lang.CATEGORY_MOVIES_SERIES,
                hookId: 'recommendations',
                renderer: this.entries.bind(this, true)
            }
            if (entries.some(e => e.hookId == entry.hookId)) {
                entries = entries.filter(e => e.hookId != entry.hookId)
            }
            entries.unshift(entry)
        } else if (!path) {
            const viewSizeX = config.get('view-size').landscape.x
            const viewSizeY = config.get('view-size').landscape.y
            const hookId = 'recommendations'
            const pageCount = config.get('home-recommendations') || 0
            
            entries = entries.filter(e => (e && e.hookId != hookId))
            
            let amount = (pageCount * (viewSizeX * viewSizeY)) - 2 // -1 due to 'entry-2x' size entry, -1 due to 'More' entry
            let metaEntriesCount = entries.filter(e => e.side == true && e.name != lang.RECOMMENDED_FOR_YOU).length

            let err, recommendations = await this.featuredEntries(amount - metaEntriesCount).catch(e => err = e)
            if (err) {
                console.error('Recommendations hook error', err)
                recommendations = []
            }
            recommendations.length && recommendations.push({
                name: lang.MORE,
                details: lang.RECOMMENDED_FOR_YOU,
                fa: 'fas fa-plus',
                type: 'group',
                renderer: this.entries.bind(this, false)
            })
            recommendations = recommendations.map(e => {
                e.hookId = hookId
                return e
            })
            entries = [...recommendations, ...entries]
            //console.error('FEATURED ENTRIES ADDED='+ JSON.stringify({rLength: recommendations.length, amount, metaEntriesCount, rAmount, length: entries.length}, null, 3))
        }
        return entries
    }
}
export default new Recommendations()
