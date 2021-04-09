const Countries = require('../countries'), Events = require('events')

class LegalIPTV extends Events {
    constructor(opts={}){
        super()
        this.repo = false
        this.opts = opts
        this.title = global.lang.LEGAL_IPTV
        this.cachingDomain = 'legal-iptv-'
        this.cachingTTL = 12 * 3600
        this.data = {}
        this.icon = 'fas fa-thumbs-up'
        this.countries = new Countries()
        if(!this.opts.shadow){
            global.ui.on('legal-iptv', ret => {
                if(ret == 'know'){
                    global.ui.emit('open-external-url', 'https://github.com/{0}'.format(this.repo))
                }
            })
        }
        this.load()
    }
	load(){
        if(!this.repo){
            global.cloud.get('configure').then(c => {
                this.repo = c['legal-iptv-repo']
                this.isReady = true
                this.emit('ready')
            }).catch(console.error)
        }
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.once('ready', fn)
		}
	}
    url(file){
        if(file){
            if(typeof(this.data[file]) != 'undefined'){
                return this.data[file]
            } else {
                return false
            }
        } else {
            return 'https://api.github.com/repos/{0}/contents/'.format(this.repo)
        }
    }
    get(file = ''){
        return new Promise((resolve, reject) => {
            const store = file ? global.rstorage : global.storage
            store.get(this.cachingDomain + file, data => {
                if(data){
                    if(!file){
                        this.data = data
                    }
                    return resolve(data)
                } else {
                    let url = this.url(file)
                    if(!url){
                        return reject('unknown file')
                    }
                    global.Download.promise({
                        url,
                        responseType: file ? 'text' : 'json',
                        timeout: 60,
                        retry: 2
                    }).then(body => {
                        if(!body){
                            reject('Server returned empty')
                        } else {
                            if(!file){
                                if(!Array.isArray(body)){
                                    try {
                                        body = JSON.parse(body)
                                    } catch(e) {
                                        return reject('failed to parse')
                                    }
                                }
                                body.filter(e => {
                                    return e.name.toLowerCase().indexOf('.m3u') != -1
                                }).forEach(e => {
                                    this.data[e['name']] = e['download_url']
                                })
                                body = this.data
                            }
                            store.set(this.cachingDomain + file, body, this.cachingTTL)
                            resolve(body)
                        }
                    }).catch(reject)
                }
            })
        })
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
    entries(){
        return new Promise((resolve, reject) => {
            this.ready(() => {
                this.get().then(() => {
                    this.countries.ready(() => {
                        let already = {}, entries = []
                        entries = entries.concat(Object.keys(this.data).map(name => {
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
                                renderer: data => {
                                    return new Promise((resolve, reject) => {
                                        this.get(name).then(content => {
                                            global.lists.directListRendererParse(content).then(list => {
                                                let url = this.url(name)
                                                if(global.activeLists.my.includes(url)){
                                                    list.unshift({
                                                        type: 'action',
                                                        name: global.lang.LIST_ALREADY_ADDED,
                                                        details: global.lang.REMOVE_LIST, 
                                                        fa: 'fas fa-minus-square',
                                                        action: () => {             
                                                            global.lists.manager.remove(url)
                                                            global.osd.show(global.lang.LIST_REMOVED, 'fas fa-info-circle', 'options', 'normal')
                                                            global.explorer.back()
                                                        }
                                                    })
                                                } else {
                                                    list.unshift({
                                                        type: 'action',
                                                        fa: 'fas fa-plus-square',
                                                        name: global.lang.ADD_TO.format(global.lang.MY_LISTS),
                                                        action: () => {
                                                            global.lists.manager.addList(url).catch(console.error)
                                                        }
                                                    })
                                                }
                                                resolve(list)
                                            }).catch(reject)
                                        }).catch(reject)
                                    })
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
                        resolve(entries)
                    })
                }).catch(reject)
            })
        })
    }
    getLocalLists(){
        return new Promise((resolve, reject) => {
            this.entries().then(es => {
                let locs = [global.lang.locale.substr(0, 2), global.lang.countryCode]
                es = es.filter(e => {
                    return e.countryCode && e.countryCode == global.lang.countryCode
                })
                if(!es.length){
                    es = es.filter(e => {
                        return e.countryCode && locs.includes(e.countryCode)
                    })
                }
                es = es.map(e => this.url(e.file))
                if(es.length){
                    resolve(es)
                } else {
                    reject('no list found for this language or country')
                }
            }).catch(reject)
        })
    }
    showInfo(){
        if(!this.opts.shadow){
            global.ui.emit('dialog', [
                {template: 'question', text: this.title, fa: this.icon},
                {template: 'message', text: global.lang.LEGAL_IPTV_INFO},
                {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
                {template: 'option', text: global.lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle'}
            ], 'legal-iptv', 'ok')
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path.split('/').pop() == global.lang.SHARED_MODE && config.get('shared-mode-reach')){
                entries.push({name: this.title, fa: this.icon, type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
}

module.exports = LegalIPTV
