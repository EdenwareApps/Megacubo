
const Events = require('events')

class WizardUtils extends Events {
    constructor(){
        super()
    }
    isMobile(){
        return !!global.cordova
    }
    validateURL(url){
		if(url && url.length > 11){
			let u = url.toLowerCase()
			if(u.substr(0, 4) == 'http' && u.indexOf('://') != -1 && u.indexOf('.') != -1){
				return true
			}
            let m = u.match(new RegExp('^([a-z]{1,6}):', 'i'))
            if(m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
                return true
            } else {
                if(u.length >= 2 && u.charAt(0) == '/' && u.charAt(1) != '/'){ // unix path
                    return true
                }
            }
		}
    }
}

class Wizard extends WizardUtils {
    constructor(){
        super()
        this.offerCommunityMode = true
        this.skipList = global.setupSkipList
        if(!this.skipList){                    
            this.on('skip-list', () => {
                global.setupSkipList = this.skipList = true
            })   
        }
        this.on('restart', () => {
            global.setupSkipList = this.isDone = this.skipList = false
            this.init().catch(console.error)
        })
    }
    async init(){
        await this.country()
        await this.lists()
        await this.performance()
        this.isDone = true
        this.active = false
        global.config.set('setup-completed', true)
    }
    async lists(){
        if(this.skipList) return true
        this.active = true
        let text = global.lang.ASK_IPTV_LIST_FIRST.split('. ').join(".\r\n"), def = 'ok', opts = [
            {template: 'question', text: global.MANIFEST.window.title, fa: 'fas fa-star'},
            {template: 'message', text},
            {template: 'option', text: global.lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok'}
        ]
        if(this.offerCommunityMode){
            opts.push({template: 'option', text: global.lang.DONT_HAVE_LIST, details: global.lang.LOAD_COMMUNITY_LISTS, fa: 'fas fa-times-circle', id: 'sh'})
        } else {
            opts.push({template: 'option', text: global.lang.ADD_LATER, fa: 'fas fa-clock', id: 'no'})
        }
        let err
        const provider = await global.promo.offer('provider').catch(e => err = e)
        if(!err && provider) {
            opts.push({
                template: 'option', 
                text: provider.title,
                details: provider.details,
                fa: provider.fa,
                id: 'provider'
            })
        }
        let choose = await global.explorer.dialog(opts, def, true)
        if(choose == 'no') {
            return true
        } else if(choose == 'sh') {
            return await this.communityMode()
        } else if(choose == 'provider') {
            let eopts = [
                {template: 'question', text: global.lang.GET_LIST_EXTERNAL, fa: provider.fa},
                {template: 'message', text: global.lang.GET_LIST_EXTERNAL_INFO},
                {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok'}
            ]            
            await global.explorer.dialog(eopts, 'ok', true)
            global.ui.emit('open-external-url', provider.url)
            return await this.lists()
        } else {
            return await this.input()
        }
    }
    async input(){
        if(this.skipList) return true
        this.active = true
        let err, ret = await global.lists.manager.addListDialog(false).catch(e => err = e)
        console.log('ASKED', ret, global.traceback())
        if(typeof(err) != 'undefined'){
            global.displayErr(global.lang.INVALID_URL_MSG)
            return await this.lists()
        }
        return true
    }
    async communityMode(){  
        if(this.skipList) return true 
        let err, ret = await global.lists.manager.communityModeDialog().catch(e => err = e)
        console.warn('communityMode', err, ret)
        if(ret !== true) {
            return await this.lists()
        }
    }
    async performance(){
        let ram = await global.diag.checkMemory().catch(console.error)
        if(typeof(ram) == 'number' && (ram / 1024) >= 2048){ // at least 2G of RAM
            return true
        }
        await global.options.performance(true)
        return true
    }
    async country(){
        if(!global.config.get('country') && global.lang.alternateCountries && global.lang.alternateCountries.length){            
            const to = global.lang.locale
            const opts = [
                {template: 'question', fa: 'fas fa-info-circle', text: global.lang.COUNTRIES}
            ].concat(global.lang.alternateCountries.concat([global.lang.countryCode]).map(id => {
                const text = global.lang.countries.nameFromCountryCode(code, to)
                return {template: 'option', text, fa: 'fas fa-globe', id}
            }))
            opts.push({template: 'option', text: global.lang.OTHER_COUNTRIES, fa: 'fas fa-globe', id: 'countries'})
            let ret = await global.explorer.dialog(opts)
            if(ret && global.lang.countries.countryCodeExists(ret)){
                global.config.set('country', ret)
            } else if(ret == 'countries') {
                await global.explorer.open(global.lang.OPTIONS +'/'+ global.lang.COUNTRIES)
            }
        }
    }
}

module.exports = Wizard
