const Countries = require('../../countries'), Events = require('events')

class IPTV extends Events {
    constructor(opts={}){
        super()
        this.icon = 'fas fa-globe'
        this.opts = opts
        this.data = {}
        this.countries = new Countries()
        this.load().catch(console.error)    
        global.uiReady(() => {
            global.explorer.addFilter(this.hook.bind(this))
        })
    }
	async load(){
        if(!this.repo){
            let cf
            await Promise.allSettled([
                global.cloud.get('configure').then(c => cf = c),
                this.countries.ready()
            ])
            if(cf){
                this.data = cf['sources'] || {}
                this.isReady = true
                this.emit('ready')
            }
        }
	}
	async ready(){
		return new Promise((resolve, reject) => {
            if(this.isReady){
                resolve()
            } else {
                this.once('ready', resolve)
            }
        })
	}
    async entries(){
        await this.ready()
        await this.get()
        await this.countries.ready()
        let already = {}, entries = []
        entries.push(...Object.keys(this.data).map(name => {
            let countryCode = this.countries.extractCountryCodes(name)
            countryCode = countryCode.length ? countryCode[0] : ''
            let displayName = this.prepareName(name, countryCode)
            if(typeof(already[displayName]) == 'undefined'){
                already[displayName] = 1
            } else {
                already[displayName]++
                displayName += ' '+ already[displayName]
            }
            return {
                name: displayName,
                fa: 'fas fa-satellite-dish',
                type: 'group',
                countryCode,
                file: name,
                renderer: async () => {
                    let list = await global.lists.directListRendererParse(await this.get(name))
                    let url = this.url(name)
                    if(global.lists.activeLists.my.includes(url)){
                        list.unshift({
                            type: 'action',
                            name: global.lang.LIST_ALREADY_ADDED,
                            details: global.lang.REMOVE_LIST, 
                            fa: 'fas fa-minus-square',
                            action: () => {             
                                global.lists.manager.remove(url)
                                global.osd.show(global.lang.LIST_REMOVED, 'fas fa-info-circle', 'list-open', 'normal')
                                setTimeout(() => {
                                    global.explorer.refreshNow()
                                }, 100)
                            }
                        })
                    } else {
                        list.unshift({
                            type: 'action',
                            fa: 'fas fa-plus-square',
                            name: global.lang.ADD_TO.format(global.lang.MY_LISTS),
                            action: () => {
                                global.lists.manager.addList(url, '', true).then(() => {
                                    setTimeout(() => global.explorer.refreshNow(), 100)
                                }).catch(console.error)
                            }
                        })
                    }
                    return list
                }
            }
        }))
        let loc = global.lang.locale.substr(0, 2), cc = global.lang.countryCode
        entries.sort((a, b) => {
            let sa = a.countryCode == cc ? 2 : ((a.countryCode == loc) ? 1 : 0)
            let sb = b.countryCode == cc ? 2 : ((b.countryCode == loc) ? 1 : 0)
            return sa < sb ? 1 : (sa > sb ? -1 : 0)
        })
        entries.unshift({
            name: global.lang.LEGAL_NOTICE,
            fa: 'fas fa-info-circle',
            type: 'action',
            action: this.showInfo.bind(this)
        })
        return entries
    }    
    async discovery(){
        await this.ready()
        let locs = []
        let nlocs = await global.lang.getActiveCountries(0).catch(console.error)
        if(Array.isArray(nlocs)){
            locs.push(...nlocs.filter(l => !locs.includes(l)))
        }
        if(!locs.length){
            locs.push(global.lang.countryCode)
        }
        let lists = locs.map(code => this.data[code]).filter(c => c)
        if(lists.length){
            const maxLists = 48
            if(lists.length > maxLists){
                lists = lists.slice(0, maxLists)
            }
            return lists.map(list => {
                list = {url: list}
                return list
            })
        } else {
            throw 'no list found for this language or country.'
        }
    }
    async entries(){
        const { sources } = await global.cloud.get('configure')
        let entries = Object.keys(sources).map(countryCode => {
            return {
                name: this.countries.nameFromCountryCode(countryCode, global.lang.locale),
                type: 'group',
                url: sources[countryCode],
                renderer: async data => {
                    let err
                    global.lists.manager.openingList = true
                    let ret = await global.lists.manager.directListRenderer(data, {fetch: true}).catch(e => err = e)
                    global.lists.manager.openingList = false
                    global.osd.hide('list-open')
                    if(err) throw err
                    return ret
                }
            }
        })
        let loc = global.lang.locale.substr(0, 2), cc = global.lang.countryCode
        entries.sort((a, b) => {
            let sa = a.countryCode == cc ? 2 : ((a.countryCode == loc) ? 1 : 0)
            let sb = b.countryCode == cc ? 2 : ((b.countryCode == loc) ? 1 : 0)
            return sa < sb ? 1 : (sa > sb ? -1 : 0)
        })
        return entries
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path.split('/').pop() == global.lang.COMMUNITY_LISTS && global.config.get('communitary-mode-lists-amount')){
                entries.splice(entries.length - 1, 0, {name: global.lang.COUNTRIES, fa: this.icon, details: this.details, type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
}

module.exports = IPTV
