class Recommendations {
    constructor(){
        this.limit = 36
    }
    async suggestions(categories, until){
        const lists = require('../lists')
        let data = await lists.epgRecommendations(categories, until, 512)
        return await this.validateChannels(data)
    }
    async validateChannels(data){
        const lists = require('../lists')
        let channels = {}
        Object.keys(data).forEach(ch => {
            let channel = global.channels.isChannel(ch)
            if(channel) {
                if(!channels[channel.name]){
                    channels[channel.name] = global.channels.epgPrepareSearch(channel)
                }
            }
        })
        let alloweds = []
        await Promise.allSettled(Object.keys(channels).map(async name => {
            const channelMappedTo = await lists.epgFindChannel(channels[name])
            if(channelMappedTo) alloweds.push(channelMappedTo)
        }))
        Object.keys(data).forEach(ch => {
            if(!alloweds.includes(ch)){
                delete data[ch]
            }
        })
        return data
    }
    mapDataToChannels(data){
        let results = []
        Object.keys(data).forEach(ch => {
            let channel = global.channels.isChannel(ch)
            if(channel) {
                Object.keys(data[ch]).forEach(start => {
                    const r = {
                        channel,
                        labels: data[ch][start].c,
                        programme: data[ch][start],
                        start: parseInt(start),
                        och: ch
                    }
                    results.push(r)
                })
            }
        })
        return results
    }
    prepareCategories(data, limit){
        const maxWords = 3, ndata = {}
        Object.keys(data).filter(k => {
			return k.split(' ').length <= maxWords
		}).sort((a, b) => {
            return data[b] - data[a]
        }).slice(0, limit).forEach(k => {
			ndata[k] = data[k]
		})
        return ndata
    }
    async tags(limit){
        const programmeCategories = this.prepareCategories(this.programmeCategories(), limit)
        if(Object.keys(programmeCategories).length < limit) {
            let additionalCategories = {}
            const lists = require('../lists')
            const additionalLimit = limit - Object.keys(programmeCategories).length
            const expandedCategories = await lists.epgExpandRecommendations(Object.keys(programmeCategories))
            if(expandedCategories) {
                Object.keys(expandedCategories).forEach(term => {
                    const score = programmeCategories[term]
                    expandedCategories[term].forEach(t => {
                        if(programmeCategories[t]) return
                        if(typeof(additionalCategories[t]) == 'undefined'){
                            additionalCategories[t] = 0
                        }
                        additionalCategories[t] += score / 2
                    })
                })
                additionalCategories = this.prepareCategories(additionalCategories, additionalLimit)
                Object.assign(programmeCategories, additionalCategories)
            }
        }
        return this.prepareCategories(programmeCategories)
    }
    async get(){
        const now = global.time()
        const timeRange = 24 * 3600
        const timeRangeP = timeRange / 100
        const until = now + timeRange  
        const amount = ((global.config.get('view-size-x') * global.config.get('view-size-y')) * 2) - 3
        const tags = await this.tags(64)
        let data = await this.suggestions(tags, until)
        // console.log('suggestions.get', tags)
        let results = this.mapDataToChannels(data)
        results = results.map(r => {
            let score = 0
            
            // bump programmes by categories amount and relevance
            r.programme.c.forEach(l => {
                if(tags[l]){
                    score += tags[l]
                }
            })
            
            // bump programmes starting earlier
            let remainingTime = r.start - now
            if(remainingTime < 0){
                remainingTime = 0
            }
            score += 100 - (remainingTime / timeRangeP)
            r.score = score
            return r
        })

        // remove repeated programmes
        let already = {}
        results = results.sortByProp('start').filter(r => {
            if(typeof(already[r.programme.t]) != 'undefined') return false
            already[r.programme.t] = null
            return true
        }).sortByProp('score', true)
        
        // equilibrate categories presence
        if(results.length > amount) {
            const quotas = {}
            let total = 0
            Object.values(tags).forEach(v => total += v)            
            Object.keys(tags).forEach(k => {
                quotas[k] = Math.max(1, Math.ceil((tags[k] / total) * amount))
            })
            let nresults = []
            while(nresults.length < amount){
                let added = 0
                const lquotas = Object.assign({}, quotas)
                nresults.push(...results.filter((r, i) => {
                    if(!r) return
                    if(r.programme.c.filter(cat => {
                        if(lquotas[cat]){
                            added++
                            lquotas[cat]--
                            results[i] = null
                            return true
                        }
                    }).length){
                        return true
                    }
                }))
                //console.log('added', added, nresults.length)
                if(!added) break
            }
            if(nresults.length < amount){
                nresults.push(...results.filter(r => r).slice(0, amount - nresults.length))
            }
            results = nresults
        }

        // transform scores to percentages
        let maxScore = 0
        results.forEach(r => { 
            if(r.score > maxScore) maxScore = r.score 
        })
        let ppScore = maxScore / 100
        results.forEach((r, i) => {
            results[i].st = Math.min(r.start < now ? now : r.start)
            results[i].score /= ppScore
        })

        return results.slice(0, amount).sortByProp('score', true).sortByProp('st').map(r => {
            const entry = global.channels.toMetaEntry(r.channel)
            entry.programme = r.programme
            entry.name = r.programme.t
            entry.originalName = r.channel.name
            if(entry.rawname) entry.rawname = r.channel.name
            entry.details = parseInt(r.score) +'% '
            if(r.programme.i){
                entry.icon = r.programme.i
            }
            if(r.start < now){
                entry.details += '<i class="fas fa-play-circle"></i> '+ global.lang.LIVE
            } else {
                entry.details += '<i class="fas fa-clock"></i> '+ global.ts2clock(r.start)
                entry.type = 'action'
                entry.action = () => {
                    global.channels.epgProgramAction(r.start, r.channel.name, r.programme, r.channel.terms)
                }
            }
            entry.och = r.och
            entry.details += ' &middot; '+ r.channel.name
            return entry
        })
    }
    channelsCategories(){
        const data = {}
        const history = require('../history')
        history.data.slice(-6).forEach(row => {
            const name = row.originalName || row.name
            const category = global.channels.getChannelCategory(name)
            if(category){
                if(typeof(data[category]) == 'undefined'){
                    data[category] = 0
                }
                data[category] += row.watched.time
            }
        })
        const pp = Math.max(...Object.values(data)) / 100
        Object.keys(data).forEach(k => data[k] = data[k] / pp)
        return data
    }
    programmeCategories(){
        const data = {}        
        const history = require('../history')
        history.data.slice(-6).forEach(row => {
            const cs = row.watched ? row.watched.categories : []
            const name = row.originalName || row.name
            const cat = global.channels.getChannelCategory(name)
            if(cat && !cs.includes(cat)){
                cs.push(cat)
            }
            if(row.groupName && !cs.includes(row.groupName)){
                cs.push(row.groupName)
            };
            cs.unique().forEach(category => {
                if(category){
                    let lc = category.toLowerCase()
                    if(typeof(data[lc]) == 'undefined'){
                        data[lc] = 0
                    }
                    data[lc] += row.watched ? row.watched.time : 180
                }
            })
        })
        const pp = Math.max(...Object.values(data)) / 100
        Object.keys(data).forEach(k => data[k] = data[k] / pp)
        return data
    }
    async channels(amount=5, excludes=[]) {
        const mega = require('../mega')
        const lists = require('../lists')
        const watching = require('../watching')

        const results = []
        const watchingIndex = (watching.currentEntries || []).map(n => global.channels.isChannel(n.name)).filter(n => n)        
        for(const e of watchingIndex) {
            const name = e.originalName || e.name
            const result = await lists.has([e])
            if(result[name] && !excludes.includes(name)) {
                results.push(e)
                if(results.length >= amount) break
            }
        }

        if(results.length < amount) {
            const index = global.channels.channelList.channelsIndex
            for(const name of this.shuffle(Object.keys(index))) {
                const e = global.channels.isChannel(name)
                if(!e) continue
                const result = await lists.has([{name: e.name, terms: e.terms}])
                if(result[name] && !excludes.includes(name)) {
                    results.push(e)
                    if(results.length >= amount) break
                }
            }
        }

        return results.map(e => {
            return global.channels.toMetaEntry({
                name: e.name,
                url: mega.build(e.name, {mediaType: 'live', terms: e.terms})
            })
        })
    }
    shuffle(arr) {
        return arr.map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value)
    }
    async entry(){
        return {
            name: global.lang.RECOMMENDED_FOR_YOU, 
            fa: 'fas fa-solid fa-thumbs-up', 
            type: 'group',
            hookId: 'recommendations', 
            renderer: this.entries.bind(this)
        }
    }
    async entries(){
        let es = await this.get().catch(console.error)
        if(!Array.isArray(es)){
            es = []
        }
        if(!es.length){
            if(global.activeEPG || global.config.get('epg-'+ global.lang.locale)) {
                es.push({
                    name: global.lang.NO_RECOMMENDATIONS_YET, 
                    type: 'action', 
                    fa: 'fas fa-info-circle', 
                    class: 'entry-empty',
                    action: async () => {                    
                        const ret = await global.menu.dialog([
                            {template: 'question', text: global.lang.NO_RECOMMENDATIONS_YET, fa: 'fas fa-info-circle'},
                            {template: 'message', text: global.lang.RECOMMENDATIONS_INITIAL_HINT},
                            {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'},
                            {template: 'option', text: global.lang.EPG, id: 'epg', fa: 'fas fa-th'}
                        ])
                        if(ret == 'epg') {
                            if(global.ALLOW_ADDING_LISTS) {
                                menu.open(global.lang.MY_LISTS +'/'+ global.lang.EPG).catch(console.error)
                            } else {
                                menu.open(global.lang.OPTIONS +'/'+ global.lang.MANAGE_CHANNEL_LIST +'/'+ global.lang.EPG).catch(console.error)
                            }
                        }
                    }
                })
            } else {
                es.push({
                    name: global.lang.EPG_DISABLED, 
                    type: 'action', 
                    fa: 'fas fa-times-circle', 
                    class: 'entry-empty',
                    action: async () => {
                        const path = global.lang.MY_LISTS +'/'+ global.lang.EPG
                        await global.menu.open(path)
                    }
                })
            }
        } else if(es.length <= 5) {
            es.push({
                name: global.lang.IMPROVE_YOUR_RECOMMENDATIONS, 
                type: 'action', 
                fa: 'fas fa-info-circle', 
                class: 'entry-empty',
                action: async () => {                    
                    await global.menu.dialog([
                        {template: 'question', text: global.lang.IMPROVE_YOUR_RECOMMENDATIONS, fa: 'fas fa-thumbs-up'},
                        {template: 'message', text: global.lang.RECOMMENDATIONS_IMPROVE_HINT},
                        {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                    ])
                }
            })
        }
        if(es.length){
            const history = require('../history')
            es.push({
                name: global.lang.WATCHED, 
                fa: 'fas fa-history', 
                type: 'group', 
                renderer: history.epg.historyEntries.bind(history.epg)
            })
        }
        return es
    }
    async featuredEntries(amount=5, excludes=[]){
        const key = 'epg-suggestions-featured-0'
        let es = await global.storage.get(key).catch(console.error)
        if(!es || !es.length) {
            es = await this.get().catch(console.error)
            if(Array.isArray(es) && es.length) {
                if(es.some(n => n.programme.i)) { // prefer entries with icons
                    es = es.filter(n => n.programme.i)
                }
                global.storage.set(key, es, {ttl: 60})
            } else es = []
        }
        es = es.filter(e => {
            const name = e.originalName || e.name
            return !excludes.includes(name)
        })
        if(es.length < amount) {
            let nwes = await this.channels(amount - es.length, excludes)
            es.push(...nwes)
        }
        es = es.map(e => global.channels.toMetaEntry(e))
        es = await global.channels.epgChannelsAddLiveNow(es, false)
        return es.slice(0, amount)
    }
    async hook(entries, path){
        if(path == global.lang.LIVE) {
            const entry = await this.entry()
            if(entries.some(e => e.hookId == entry.hookId)){
                entries = entries.filter(e => e.hookId != entry.hookId)
            }
            entries.unshift(entry)
        } else if(!path) {
            const amount = 3, hookId = 'recommendations'
            entries =  entries.filter(e => e.hookId != hookId)
            const excludes = entries.map(e => (e.originalName || e.name))
            let recommendations = await this.featuredEntries(amount, excludes)
            recommendations = recommendations.map(e => {
                e.hookId = hookId
                return e
            })
            entries.unshift(...recommendations)
        }
        return entries
    }
}

module.exports = new Recommendations()
