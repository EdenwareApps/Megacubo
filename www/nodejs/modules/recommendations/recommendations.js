import menu from '../menu/menu.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import mega from '../mega/mega.js'
import config from '../config/config.js'
import PQueue from 'p-queue'
import renderer from '../bridge/bridge.js'
import cloud from '../cloud/cloud.js'
import { ts2clock, time } from '../utils/utils.js'
import { EventEmitter } from 'events'
import { Tags } from './tags.js'

class Recommendations extends EventEmitter {
    constructor() {
        super()
        this.readyState = 0
        this.tags = new Tags()
        this.updaterQueue = new PQueue({concurrency: 1})
        this.epgLoaded = false
        this.someListLoaded = false
        this.listsLoaded = false
        this.cacheKey = 'epg-suggestions-featured-1'
        renderer.ready(() => {
            this.updateIntervalSecs = cloud.expires.trending || 300
            this.tags.on('updated', () => this.scheduleUpdate())
            global.lists.on('list-loaded', () => {
                if(!this.someListLoaded && this.readyState < 4) {
                    this.someListLoaded = true
                    this.scheduleUpdate()
                }
            })
            global.lists.on('epg-update', () => {
                this.epgLoaded || storage.delete(this.cacheKey)
                this.epgLoaded = true
                this.scheduleUpdate()
            })
            global.lists.ready().then(async () => {
                this.listsLoaded = true
                this.scheduleUpdate()
            }).catch(err => console.error(err))
            
            lang.ready().catch(err => console.error(err)).finally(() => {
                global.lists.epgReady().then(() => {
                    this.epgLoaded || storage.delete(this.cacheKey)
                    this.epgLoaded = true
                    this.scheduleUpdate()
                }).catch(err => console.error(err))
            })
        })
    }
    async scheduleUpdate() {
        return this.updaterQueue.size || this.updaterQueue.add(async () => {
            await this.update().catch(err => console.error(err))
        })
    }
    async validateChannels(data) {
        const chs = {}, now = time()
        for(const ch in data) {
            let channel = global.channels.isChannel(ch)
            if (channel) {
                if(typeof(chs[channel.name]) == 'undefined') {
                    chs[channel.name] = global.channels.epgPrepareSearch(channel)
                    chs[channel.name].candidates = []
                }
                for(const p in data[ch]) {
                    if(parseInt(p) <= now && data[ch][p].e < now) {
                        chs[channel.name].candidates.push({
                            t: data[ch][p].t,
                            ch
                        })
                        break
                    }
                }
            }
        }
        const ret = {}, alloweds = await global.lists.epg.validateChannels(chs)
        for(const ch in alloweds) {
            ret[ch] = data[ch]
        }
        return ret
    }
    async processEPGRecommendations(data) {
        data = await this.validateChannels(data)
        const results = [], already = new Set()
        for(const ch in data) {
            let channel = global.channels.isChannel(ch)
            if (channel) {
                let t
                for (const programme of data[ch]) {
                    if(!t) {
                        t = programme.t
                        if(already.has(t)) return // prevent same program on diff channels
                        already.add(t)
                    }
                    results.push({
                        channel,
                        labels: programme.c,
                        programme,
                        start: parseInt(programme.start),
                        och: ch
                    })
                }
            }
        }
        return results
    }
    async get(tags, amount=25) {
        if(!global.lists?.epg?.loaded) return []
        const now = (Date.now() / 1000)
        const timeRange = 3 * 3600
        const timeRangeP = timeRange / 100
        const until = now + timeRange
        const applyParentalControl = !global.lists.parentalControl.lazyAuth()
        if(!tags) {
            tags = await this.tags.get()
        }
        if(applyParentalControl) {
            for(const tag in tags) {
                if (!global.lists.parentalControl.has(tag)) {
                    delete tags[tag]
                }
            }
        }

        const data = await global.lists.epg.getRecommendations(tags, until, amount * 4)
        const processing = this.processEPGRecommendations(data)
        const interests = new Set()
        global.channels.history.get().some(e => {
            const c = global.channels.isChannel(e)
            if(c) {
                interests.add(c.name)
                return true
            }
        })
        if(channels.trending.currentEntries && channels.trending.currentEntries.length) {
            global.channels.trending.currentEntries.some(e => {
                if(e.type != 'select') return
                interests.add(e.originalName || e.name)
                return true
            })
        }
        
        // console.log('suggestions.get', tags)
        let maxScore = 0, results = await processing
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
        let already = new Set()
        results = results.sortByProp('score', true).filter(e => {
            if (already.has(e.programme.t)) return false
            already.add(e.programme.t)
            return true
        })        

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

        const slice = []
        results = results.sortByProp('score', true).sortByProp('st')
        for(const r of results) {
            if(!applyParentalControl || !global.lists.parentalControl.has(r.programme.t)) {
                slice.push(r)
                if(slice.length >= amount) break
            }
        }
        return slice.map(r => {
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
    async getChannels(amount=5, _excludes=[]) {
        const already = new Set()
        const excludes = new Set(_excludes)
        const isChannelCache = {}, validateCache = {}
        const channels = global.channels
        if(!channels || !channels.channelList) return []

        const channelsIndex = channels.channelList.channelsIndex
        const channel = e => {
            const name = typeof(e) == 'string' ? e : (e.originalName || e.name)
            if (typeof(isChannelCache[name]) == 'undefined') {
                isChannelCache[name] = false
                if (name && !excludes.has(name)) {
                    const e = channels.isChannel(name)
                    if (e) {
                        isChannelCache[name] = e
                    }
                }
            }
            return isChannelCache[name]
        }
        const validateMulti = async es => {
            const hasMap = es.map((e, i) => {
                const name = typeof(e) == 'string' ? e : (e.originalName || e.name)
                if (typeof(validateCache[name]) == 'undefined' && !excludes.has(name)) {
                    return channel(e)
                }
            }).filter(e => e)
            const results = await global.lists.has(hasMap)
            Object.assign(validateCache, results)
            return es.map((e, i) => {
                const name = typeof(e) == 'string' ? e : (e.originalName || e.name)
                if (typeof(validateCache[name]) == 'undefined') {
                    const { name } = channel(e)
                    return validateCache[name]
                }
                return validateCache[name]
            })
        }
        const results = [], trending = channels.trending
        if(trending.currentEntries && trending.currentEntries.length) {
            const trendingIndex = (trending.currentEntries.filter(e => e.type == 'select') || []).map(e => {
                const c = channel(e)
                if(c && !already.has(c.name)) { // do not add it to already for now
                    return c
                }
            }).filter(c => c)
            const validations = await validateMulti(trendingIndex)
            validations.forEach((valid, i) => {
                if(!valid || already.has(trendingIndex[i].name)) return
                already.add(trendingIndex[i].name)
                results.push(trendingIndex[i])
            })
        }
        if(results.length < amount) {
            const shuffledIndex = this.shuffledIndex().slice(0, amount * 4)
            const validations = await validateMulti(shuffledIndex)
            validations.forEach((valid, i) => {
                if(!valid || already.has(shuffledIndex[i])) return
                already.add(shuffledIndex[i])
                results.push({
                    name: shuffledIndex[i],
                    terms: channelsIndex[shuffledIndex[i]]                
                })
            })
        }
        return results.map(e => {
            return channels.toMetaEntry({
                name: e.name,
                url: mega.build(e.name, { mediaType: 'live', terms: e.terms })
            })
        })
    }
    shuffle(arr) {
        const names = global.channels.history.get().map(e => (e.originalName || e.name))
        if(global.channels.trending.currentRawEntries) {
            names.push(...global.channels.trending.currentRawEntries.map(e => e.name))
        }
        const known = new Set(names)
        return arr.map(value => {
            const sort = known.has(value) ? 1 : (Math.random() * 0.9)
            return {value, sort}
        }).sortByProp('sort', true).map(({value}) => value)
    }
    shuffledIndex() {
        if(!global.channels.channelList) return []
        const index = global.channels.channelList.channelsIndex
        const hash = Object.keys(global.channels.channelList.channelsIndex).join('|') +':'+ typeof(global.channels.trending.currentRawEntries)
        if(!this._shuffledIndex || this._shuffledIndex.hash != hash) { // shuffle once per run on each channelList
            this._shuffledIndex = {hash, index: this.shuffle(Object.keys(index))}
        }
        return this._shuffledIndex.index
    }
    async entries(vod) {
        const limit = 25
        const adjust = e => {
            if(e.programme && e.programme.t) {
                if(!e.originalName) {
                    e.originalName = e.name
                }
                e.details = e.name
                e.name = e.programme.t
            }
            return e
        }
        const improveEntry = {
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
        }
        const noRecommendations = {
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
                        menu.open(lang.MY_LISTS + '/' + lang.EPG).catch(err => console.error(err))
                    } else {
                        menu.open(lang.OPTIONS + '/' + lang.MANAGE_CHANNEL_LIST + '/' + lang.EPG).catch(err => console.error(err))
                    }
                }
            }
        }
        let es
        if(vod === true) {
            es = await global.lists.multiSearch(await this.tags.get(), {limit, type:'video', group: false, typeStrict: true})
        } else {
            es = await this.get(null, limit).catch(err => console.error(err))
        }
        if (!Array.isArray(es)) {
            es = []
        }
        if (!es.length) {
            if (global.lists?.epg?.loaded) {
                if(vod) {
                    es.push(noRecommendations)
                } else {
                    const featured = await this.featuredEntries(limit)
                    Array.isArray(featured) && es.push(...featured.map(adjust))
                    es.unshift(es.length ? improveEntry : noRecommendations)
                }
            } else {
                es.push({
                    name: lang.EPG_DISABLED,
                    type: 'action',
                    fa: 'fas fa-times-circle',
                    class: 'entry-empty',
                    action: async () => {
                        await menu.open(lang.EPG)
                    }
                })
            }
        } else if (es.length <= 5) {
            es.unshift(improveEntry)
            if(!vod) {
                const featured = this.featuredEntries(limit - es.length)
                Array.isArray(featured) && es.push(...featured.map(adjust))
            }
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
        const amount = 48
        let es = [], tmpkey = this.cacheKey
        if(global.channels && global.channels.channelList) {
            tmpkey += global.channels.channelList.key
        }
        let tags, channels, timer
        const collectFeaturedEntries = async (channels, force) => {
            if(channels && (force || !this.featuredEntriesCache?.data.length)) {
                clearTimeout(timer)
                this.featuredEntriesCache = {data: channels, key: tmpkey}
                timer = setTimeout(() => {
                    global.menu.updateHomeFilters()
                }, 1000)
            }
        }
        es = await storage.get(this.cacheKey).catch(err => console.error(err))
        if (es && es.length) {
            es = es.map(e => global.channels.toMetaEntry(e))
            collectFeaturedEntries(channels)
        } else {
            if(!this.featuredEntriesCache || !this.featuredEntriesCache.data.length) {
                channels = await this.getChannels(amount, []) // pick weak recommendations for now, as EPG may take some time to be ready
                if(channels.length) {
                    collectFeaturedEntries(channels)

                    channels = await global.channels.epgChannelsAddLiveNow(channels, false)
                    collectFeaturedEntries(channels)
                    if(this.readyState < 2) {
                        this.readyState = 2
                    }
                }
            }

            tags = await this.tags.get()
            es = await this.get(tags, 3 * amount).catch(err => console.error(err))
            if (Array.isArray(es) && es.length) {
                if (es.some(n => n.programme.i)) { // prefer entries with icons
                    es = es.filter(n => n.programme.i)
                }
                collectFeaturedEntries(es, true)
                storage.set(this.cacheKey, es, {ttl: this.updateIntervalSecs})
            } else {
                es = []
            }
        }

        if (es.length < amount) {
            channels = await this.getChannels(amount - es.length, es.map(e => (e.originalName || e.name)))
            collectFeaturedEntries(es.concat(channels))
            channels = await global.channels.epgChannelsAddLiveNow(channels, false)
            es.push(...channels)
            collectFeaturedEntries(es, true)
        }
     
        this.readyState = (this.epgLoaded && this.listsLoaded) ? 4 : 3
    }
    async featuredEntries(amount=5) {
        const results = []
        if (amount && this.featuredEntriesCache && this.featuredEntriesCache.data) {
            for (const entry of this.featuredEntriesCache.data) {
                if (results.length >= amount) break
                results.push(entry)
            }
        }
        if (!results.length && this.readyState < 4) {
            const emptyEntries = Array(amount - results.length).fill(null)
            results.push(...emptyEntries.map((_, i) => {
                return {
                    name: ' &nbsp;',
                    fa: 'fa-mega',
                    type: 'action',
                    class: 'entry-busy-x',
                    id: 'recommendations-busy-'+ i, // for svelte to diff these empty entries
                    action: () => {}
                }
            }))
        }
        return results
    }
    async hook(entries, path) {
        const hookId = 'recommendations'
        if (path == lang.LIVE) {
            const entry = {
                name: lang.RECOMMENDED_FOR_YOU,
                fa: 'fas fa-solid fa-thumbs-up',
                type: 'group',
                details: lang.LIVE,
                hookId,
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
                hookId,
                renderer: this.entries.bind(this, true)
            }
            if (entries.some(e => e.hookId == entry.hookId)) {
                entries = entries.filter(e => e.hookId != entry.hookId)
            }
            entries.unshift(entry)
        } else if (!path) {
            const viewSizeX = config.get('view-size').landscape.x
            const viewSizeY = config.get('view-size').landscape.y
            const pageCount = config.get('home-recommendations') || 0
            let recommendations = []
            
            entries = entries.filter(e => (e && e.hookId != hookId))
            
            if(pageCount) {
                let metaEntriesCount = entries.filter(e => e.side == true && e.name != lang.RECOMMENDED_FOR_YOU).length
                let amount = pageCount == 1 ?
                    ((viewSizeX * Math.max(1, viewSizeY - 1)) + (Math.ceil(metaEntriesCount / viewSizeX) * viewSizeX)) : 
                    (pageCount * (viewSizeX * viewSizeY));                    
                amount -= 2 // -1 due to 'entry-2x' size entry, -1 due to 'More' entry
                let err
                if(amount > 0) {
                    recommendations = await this.featuredEntries(amount - metaEntriesCount).catch(e => err = e)
                }
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
            }
        }
        return entries
    }
}
export default new Recommendations()
