class Suggestions {
    constructor(master){
        this.limit = 36
        this.master = master
    }
    async rawSuggestions(categories, until){
        let data = await global.lists.epgSuggestions(categories, until)
        let channels = {}
        //console.log('rawSuggestions', Object.assign({}, data))
        Object.keys(data).forEach(ch => {
            let channel = global.channels.isChannel(ch)
            if(channel) {
                if(!channels[channel.name]){
                    channels[channel.name] = global.channels.epgPrepareSearch(channel)
                }
            }
        })
        //console.log('rawSuggestions', Object.assign({}, channels))
        let alloweds = []
        await Promise.all(Object.keys(channels).map(async name => {
            const channelMappedTo = await global.lists.epgFindChannel(channels[name])
            if(channelMappedTo) alloweds.push(channelMappedTo)
        }))
        //console.log('rawSuggestions', alloweds)
        Object.keys(data).forEach(ch => {
            if(!alloweds.includes(ch)){
                delete data[ch]
            }
        })
        //console.log('rawSuggestions', data)
        return data
    }
    async get(){
        const now = global.time()
        const timeRange = 24 * 3600
        const timeRangeP = timeRange / 100
        const until = now + timeRange  
        const amount = ((global.config.get('view-size-x') * global.config.get('view-size-y')) * 2) - 2
        const channels = this.channels()
        const programmeCategories = this.programmeCategories()
        const expandedCategories = await global.lists.epgExpandSuggestions(Object.keys(programmeCategories))
        const allFoundCategories = Object.values(expandedCategories).flat()
        //console.warn('FOUNDCCATS', expandedCategories, allFoundCategories)
        let results = [], data = await this.rawSuggestions(allFoundCategories, until)
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
                            console.warn('half score', k, l, programmeCategories[k])
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
                nresults = nresults.concat(results.filter((r, i) => {
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
                nresults = nresults.concat(results.filter(r => r).slice(0, amount - nresults.length))
            }
            results = nresults
        }
        // transform scores to percentages
        let maxScore = 0
        results.forEach(r => { if(r.score > maxScore) maxScore = r.score })
        let ppScore = maxScore / 100
        results.forEach((r, i) => results[i].score /= ppScore)
        return results.slice(0, amount).sortByProp('start').map(r => {
            const entry = global.channels.toMetaEntry(r.channel)
            entry.name = r.programme.t
            entry.originalName = r.channel.name
            entry.details = ''; // parseInt(r.score) +'% '
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
