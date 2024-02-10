const Events = require('events')

class PublicLists extends Events {
    constructor(opts={}){
        super()
        const Countries = require('../../countries')
        this.opts = opts
        this.data = {}
        this.countries = new Countries()
        this.load().catch(console.error)
        global.uiReady(() => global.explorer.addFilter(this.hook.bind(this)))
    }
    async load() {
        if (!Object.keys(this.data).length) {
            await global.cloud.get('configure').then(c => {
                this.data = c['legal-iptv'] || {}
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
                list = {type: 'public', url: list, health: factor * (1 - (i * (1 / lists.length)))}
                return list
            }))
        }
    }
    async entries(){
        await this.ready()
        let entries = Object.keys(this.data).map(countryCode => {
            return {
                name: this.countries.getCountryName(countryCode, global.lang.locale),
                type: 'group',
                url: this.data[countryCode],
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
    entry() {
        return {
            name: global.lang.PUBLIC_LISTS, type: 'group', fa: 'fas fa-broadcast-tower',
            renderer: async () => {
                let toggle = global.config.get('public-lists') ? 'fas fa-toggle-on' : 'fas fa-toggle-off'
                let options = [
                    {name: global.lang.ACCEPT_LISTS, details: '', type: 'select', fa: toggle,
                    renderer: async () => {
                        let def = global.config.get('public-lists')
                        return [
                            {
                                name: global.lang.YES,
                                value: 'yes'
                            }, 
                            {
                                name: global.lang.ONLY,
                                value: 'only'
                            }, 
                            {
                                name: global.lang.NO,
                                value: ''
                            }
                        ].map(n => {
                            return {
                                name: n.name,
                                type: 'action',
                                selected: def == n.value,
                                action: () => {
                                    global.config.set('public-lists', n.value)
                                    global.explorer.refreshNow()
                                }
                            }
                        })
                    }},
                    {
                        name: global.lang.LEGAL_NOTICE,
                        details: 'DMCA',
                        fa: 'fas fa-info-circle',
                        type: 'action',
                        action: this.showInfo.bind(this)
                    }
                ]
                return options
            }
        }
    }
    async hook(entries, path){
        if(path.split('/').pop() == global.lang.PUBLIC_LISTS && global.config.get('public-lists')){
            entries.splice(entries.length - 1, 0, {
                name: global.lang.COUNTRIES,
                fa: 'fas fa-globe',
                details: this.details,
                type: 'group',
                renderer: this.entries.bind(this)
            })
        } else if(path.split('/').pop() == global.lang.MY_LISTS) {
            global.options.insertEntry(this.entry(), entries, 1, global.lang.ADD_LIST)
        }
        return entries
    }
    showInfo(){
        global.explorer.dialog([
            {template: 'question', text: global.lang.PUBLIC_LISTS, fa: 'fas fa-users'},
            {template: 'message', text: global.lang.PUBLIC_LISTS_INFO},
            {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
            {template: 'option', text: global.lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle'}
        ], 'ok').then(ret => {
            if(ret == 'know'){
                global.ui.emit('open-external-url', 'https://github.com/EdenwareApps/Legal-IPTV')
            }
        }).catch(console.error)
    }
}

module.exports = PublicLists
