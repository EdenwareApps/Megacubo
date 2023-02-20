const Countries = require('../countries'), Events = require('events')

class IPTV extends Events {
    constructor(opts={}){
        super()
        this.opts = opts
        this.data = {}
        this.countries = new Countries()
        this.load().catch(console.error)
    }
	async load(){
        if(!this.repo){
            let cf
            await Promise.all([
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
    async getLocalLists(){
        let locs = []
        let nlocs = await global.lang.getActiveCountries().catch(console.error)
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
            return lists
        } else {
            throw 'no list found for this language or country.'
        }
    }
}

module.exports = IPTV
