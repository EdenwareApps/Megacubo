const { EventEmitter } = require('events')

class CommunityListsIPTVORG extends EventEmitter {
    constructor(opts={}){
        super()
        const Countries = require('../../countries')
        this.opts = opts
        this.data = {}
        this.countries = new Countries()
        this.load().catch(console.error)
        global.rendererReady(() => global.menu.addFilter(this.hook.bind(this)))
    }
    async load() {
        if (!Object.keys(this.data).length) {
            const cloud = require('../../cloud')
            await cloud.get('configure').then(c => {
                this.data = c['sources'] || {}
            }).catch(console.error)
        }
        this.isReady = true
        this.emit('ready')
    }
	async ready(){
		await new Promise((resolve, reject) => {
            if(this.isReady){
                resolve()
            } else {
                this.once('ready', resolve)
            }
        })
	}
    async discovery(adder){        
        if(global.ALLOW_COMMUNITY_LISTS) {
            await this.ready()
            let locs = await global.lang.getActiveCountries(0).catch(console.error)
            if(Array.isArray(locs) || !locs.length){
                locs.push = [global.lang.countryCode]
            }
            let lists = locs.map(code => this.data[code]).filter(c => c)
            if(lists.length){
                const maxLists = 48, factor = 0.9 // factor here adds some gravity to grant higher priority to community lists instead
                if(lists.length > maxLists){
                    lists = lists.slice(0, maxLists)
                }
                adder(lists.map((list, i) => {
                    list = {type: 'community', url: list, health: factor * (1 - (i * (1 / lists.length)))}
                    return list
                }))
            } else {
                console.error('[CommunityListsIPTVORG] no list found for this language or country.')
            }
        }
        return []
    }
    async entries(){
        await this.ready()
        let entries = Object.keys(this.data)
        entries.unshift(global.lang.countryCode)
        entries = entries.unique().map(countryCode => {
            return {
                name: this.countries.getCountryName(countryCode, global.lang.locale),
                type: 'group',
                url: this.data[countryCode],
                countryCode,
                renderer: async data => {
                    const lists = require('../../lists')
                    let err
                    lists.manager.openingList = true
                    let ret = await lists.manager.directListRenderer(data, {fetch: true}).catch(e => err = e)
                    lists.manager.openingList = false
                    global.osd.hide('list-open')
                    if(err) throw err
                    return ret
                }
            }
        })
        return entries
    }
    async hook(entries, path){
        if(path.split('/').pop() == global.lang.COMMUNITY_LISTS && global.config.get('communitary-mode-lists-amount')){
            entries.splice(entries.length - 1, 0, {name: global.lang.COUNTRIES, details: global.lang.ALL, fa: 'fas fa-globe', details: this.details, type: 'group', renderer: this.entries.bind(this)})
        }
        return entries
    }
}

module.exports = CommunityListsIPTVORG
