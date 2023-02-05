
class Suggestions {
    constructor(master){
        this.limit = 36
        this.master = master
    }
    mergeMaps(a, b, until){
        Object.keys(b).forEach(ch => {
            if(typeof(a[ch]) == 'undefined'){
                a[ch] = {}
            }
            Object.keys(b[ch]).forEach(start => {
                if(parseInt(start) <= until && typeof(a[ch][start]) == 'undefined'){
                    a[ch][start] = b[ch][start]
                }
            })
        })
        return a
    }
    mapSize(a){
        let l = 0
        Object.values(a).forEach(v => {
            l += Object.keys(v).length
        })
        return l
    }
    async suggestions(categories, until){
        let data
        if(categories.length < 10) { // few tags, do an extended search to maximize results
            data = {}
            await Promise.all(categories.map(async c => {
                let map = await global.lists.epgSearch(global.lists.terms(c))
                data = this.mergeMaps(data, map, until)
            }))
        } else {
            data = await global.lists.epgSuggestions(categories, until)
        }
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
        await Promise.all(Object.keys(channels).map(async name => {
            const channelMappedTo = await global.lists.epgFindChannel(channels[name])
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
    async featuredEntry(){
        const key = 'epg-suggestions-featured-0'
        let e = await global.storage.promises.get(key).catch(console.error)
        if(!e || !e.name){
            e = await this.get()
            if(e.length){
                const minWindow = 600, now = global.time(), validate = n => {
                    return (n.program.e - minWindow) > now
                }
                if(e.some(n => n.program.i)){ // prefer entries with icons
                    e = e.filter(n => n.program.i)
                }
                e = e.shift()
                const ttl = Math.min(600, (e.program.e - minWindow) - now)
                if (ttl > 0) {
                    global.storage.promises.set(key, e, ttl)                    
                }
            } else {
                e = null
            }
        }
        return e
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
    async get(){
        const categoriesLimit = 64
        const now = global.time()
        const timeRange = 24 * 3600
        const timeRangeP = timeRange / 100
        const until = now + timeRange  
        const amount = ((global.config.get('view-size-x') * global.config.get('view-size-y')) * 2) - 2
        const channels = this.channels()
        const programmeCategories = this.prepareCategories(this.programmeCategories(), categoriesLimit)
        const expandedCategories = Object.keys(programmeCategories).length >= categoriesLimit ? {} : (await global.lists.epgExpandSuggestions(Object.keys(programmeCategories)))
        const allFoundCategories = [...new Set(Object.keys(programmeCategories).concat(Object.values(expandedCategories).flat()).filter(t => {
            return t.split(' ').length <= 3 // filter too specific tags, like season+episode formatted ones
        }))].slice(0, categoriesLimit)
        let data = await this.suggestions(allFoundCategories, until)
        console.log('suggestions.get', allFoundCategories, Object.keys(programmeCategories), expandedCategories)
        let results = this.mapDataToChannels(data)
        const watching = {}
        if(global.watching.currentEntries){
            let wpp, wmax = 0
            global.watching.currentEntries.forEach(r => {
                if(r.users > wmax) wmax = r.users
            })
            wpp = wmax / 100
            global.watching.currentEntries.forEach(r => {
                watching[r.name] = r.users / wpp
            })
        }
        results = results.map(r => {
            let score = 0
            
            // bump programmes from same categories
            r.programme.c.forEach(l => {
                if(programmeCategories[l]){
                    score += programmeCategories[l]
                } else if(allFoundCategories.includes(l)) {
                    Object.keys(expandedCategories).forEach(k => {
                        if(expandedCategories[k].includes(l)){
                            // console.warn('half score', k, l, programmeCategories[k])
                            score += (programmeCategories[k] / 2) // half score for indirect tags
                        }
                    })
                }
            })
            
            // bump programmes from same channels
            if(channels[r.channel.name]){
                score += channels[r.channel.name]
            }
            
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
        let already = []
        results = results.sortByProp('start').filter(r => {
            if(already.includes(r.programme.t)) return false
            already.push(r.programme.t)
            return true
        }).sortByProp('score', true)
        
        // equilibrate categories presence
        if(results.length > amount) {
            const quotas = {}
            let total = 0
            Object.values(programmeCategories).forEach(v => total += v)            
            Object.keys(programmeCategories).forEach(k => {
                quotas[k] = Math.max(2, Math.ceil((programmeCategories[k] / total) * amount))
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
            entry.program = r.programme
            entry.name = r.programme.t
            entry.originalName = r.channel.name
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
    channels(){
        const data = {}
        this.master.data.slice(-6).forEach(row => {
            const name = row.originalName || row.name
            if(typeof(data[name]) == 'undefined'){
                data[name] = 0
            }
            data[name] += row.watched.time
        })
        const pp = Math.max(...Object.values(data)) / 100
        Object.keys(data).forEach(k => data[k] = data[k] / pp)
        return data
    }
    channelsCategories(){
        const data = {}
        this.master.data.slice(-6).forEach(row => {
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
        this.master.data.slice(-6).forEach(row => {
            const cs = row.watched.categories
            const name = row.originalName || row.name
            const cat = global.channels.getChannelCategory(name)
            if(cat && !cs.includes(cat)){
                cs.push(cat)
            }
            if(row.groupName && !cs.includes(row.groupName)){
                cs.push(row.groupName)
            };
            [...new Set(cs)].forEach(category => {
                if(category){
                    let lc = category.toLowerCase()
                    if(typeof(data[lc]) == 'undefined'){
                        data[lc] = 0
                    }
                    data[lc] += row.watched.time
                }
            })
        })
        const pp = Math.max(...Object.values(data)) / 100
        Object.keys(data).forEach(k => data[k] = data[k] / pp)
        return data
    }
}

module.exports = Suggestions
