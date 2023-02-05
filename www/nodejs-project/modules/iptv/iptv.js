const Countries = require('../countries'), Events = require('events')

class IPTV extends Events {
    constructor(opts={}){
        super()
        this.repo = false
        this.opts = opts
        this.details = ''
        this.cachingDomain = 'iptv-'
        this.cachingTTL = 12 * 3600
        this.data = {}
        this.icon = 'fas fa-globe'
        this.countries = new Countries()
        this.load()
    }
    title(){
        return global.lang.COUNTRIES
    }
	load(){
        if(!this.repo){
            global.cloud.get('configure').then(c => {
                this.repo = c['iptv-repo'] || 'iptv-org/iptv'
                this.details = global.lang.FROM_X.format(this.repo.split('/')[0])
                this.isReady = true
                this.emit('ready')
            }).catch(console.error)
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
    url(file){
        if(file){
            if(typeof(this.data[file]) != 'undefined'){
                return this.data[file]
            } else {
                return false
            }
        } else {
            return 'https://api.github.com/repos/{0}/contents/streams/'.format(this.repo)
        }
    }
    async get(file = ''){
        let url = this.url(file)
        if(!url){
            throw 'unknown file'
        }
        let body = await global.Download.get({
            url,
            responseType: file ? 'text' : 'json',
            timeout: 60,
            retry: 2,
            p2p: global.config.get('p2p'),
            cacheTTL: 3600
        })
        if(!body){
            throw 'Server returned empty'
        } else {
            if(!file){
                if(!Array.isArray(body)){
                    try {
                        body = global.parseJSON(body)
                    } catch(e) {
                        throw 'failed to parse'
                    }
                }
                body.filter(e => {
                    return e.name.toLowerCase().indexOf('.m3u') != -1
                }).forEach(e => {
                    this.data[e['name']] = e['download_url']
                })
                body = this.data
            }
            return body
        }
    }
    prepareName(name, countryCode){
        let n = this.countries.nameFromCountryCode(countryCode, global.lang.locale)
        if(n){
            return n
        }
        return name.replace(new RegExp('\\.m3u.*', 'i'), '').replace(new RegExp('[_\\-]+', 'g'), ' ')
    }
    isKnownURL(url){
        return url.indexOf(this.repo) != -1
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
                                    global.explorer.refresh()
                                }, 100)
                            }
                        })
                    } else {
                        list.unshift({
                            type: 'action',
                            fa: 'fas fa-plus-square',
                            name: global.lang.ADD_TO.format(global.lang.MY_LISTS),
                            action: () => {
                                global.lists.manager.addList(url).then(() => {
                                    setTimeout(() => {
                                        global.explorer.refresh()
                                    }, 100)
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
    getLocalLists(){
        return new Promise((resolve, reject) => {
            this.entries().then(es => {
                let locs = []
                global.lang.getActiveCountries().then(nlocs => {
                    nlocs.forEach(loc => {
                        if(!locs.includes(loc)){
                            loc.push(loc)
                        }
                    })
                }).catch(console.error).finally(() => {
                    let nes = [], maxLists = 48
                    if(locs.includes(global.lang.countryCode)){
                        nes = es.filter(e => {
                            return e.countryCode && e.countryCode == global.lang.countryCode
                        })
                    }
                    es.map(e => {
                        if(nes.length >= maxLists) return
                        if(e.countryCode && e.countryCode != global.lang.countryCode && locs.includes(e.countryCode)){
                            nes.push(e)
                        }
                    })
                    nes = nes.map(e => this.url(e.file))
                    if(nes.length){
                        resolve(nes)
                    } else {
                        reject('no list found for this language or country.')
                    }
                })
            }).catch(reject)
        })
    }
    showInfo(){
        if(!this.opts.shadow){
            global.explorer.dialog([
                {template: 'question', text: this.title(), fa: this.icon},
                {template: 'message', text: global.lang.IPTV_INFO},
                {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
                {template: 'option', text: global.lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle'}
            ], 'ok').then(ret => {
                if(ret == 'know'){
                    global.ui.emit('open-external-url', 'https://github.com/{0}'.format(this.repo))
                }
            }).catch(console.error)
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path.split('/').pop() == global.lang.COMMUNITY_LISTS && global.config.get('communitary-mode-lists-amount')){
                entries.splice(entries.length - 1, 0, {name: this.title(), fa: this.icon, details: this.details, type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
}

module.exports = IPTV
