
class LegalIPTV {
    constructor(opts){
        this.title = global.lang.LEGAL_IPTV
        this.repo = 'Free-IPTV/Countries'
        this.cachingDomain = 'legal-iptv-'
        this.cachingTTL = 12 * 3600
        this.data = {}
        this.icon = 'fas fa-thumbs-up'
        global.ui.on('legal-iptv', ret => {
            if(ret == 'know'){
                global.ui.emit('open-external-url', 'https://github.com/{0}'.format(this.repo))
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
                        timeout: 60000,
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
    prepareName(name){
        return name.replace(new RegExp('\\.m3u.*', 'i'), '').replace(new RegExp('[_\\-]+', 'g'), ' ')
    }
    entries(){
        return new Promise((resolve, reject) => {  
            if(!Object.values(this.data).length){
                this.showInfo()
            }
            this.get().then(() => {
                let entries = [{
                    name: global.lang.KNOW_MORE,
                    fa: 'fas fa-info-circle',
                    type: 'action',
                    action: this.showInfo.bind(this)
                }]
                entries = entries.concat(Object.keys(this.data).map(name => {
                    return {
                        name: this.prepareName(name),
                        fa: 'fas fa-satellite-dish',
                        type: 'group',
                        renderer: data => {
                            return new Promise((resolve, reject) => {
                                this.get(name).then(content => {
                                    global.lists.directListRendererParse(content, this.data[name]).then(resolve).catch(reject)
                                }).catch(reject)
                            })
                        }
                    }
                }))
                resolve(entries)
            })
        })
    }
    showInfo(){
        global.ui.emit('dialog', [
            {template: 'question', text: this.title, fa: this.icon},
            {template: 'message', text: global.lang.LEGAL_IPTV_INFO},
            {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
            {template: 'option', text: global.lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle'}
        ], 'legal-iptv', 'ok')
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == global.lang.IPTV_LISTS){
                entries.push({name: this.title, fa: this.icon, type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
}

module.exports = LegalIPTV
