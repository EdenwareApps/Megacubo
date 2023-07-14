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
