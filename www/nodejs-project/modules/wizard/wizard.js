
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
        this.init().catch(console.error)
    }
    async init(){
        await this.start()
        await this.performance()
        await this.countries()
        this.isDone = true
        this.active = false
        global.config.set('setup-completed', true)
    }
    async start(){
        if(this.skipList) return true
        this.active = true
        let text = global.lang.ASK_IPTV_LIST_FIRST.split('. ').join(".\r\n"), def = 'ok', opts = [
            {template: 'question', text: 'Megacubo', fa: 'fas fa-star'},
            {template: 'message', text},
            {template: 'option', text: global.lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok'}
        ]
        if(this.offerCommunityMode){
            opts.push({template: 'option', text: global.lang.DONT_HAVE_LIST, details: global.lang.LOAD_COMMUNITY_LISTS, fa: 'fas fa-times-circle', id: 'sh'})
        } else {
            opts.push({template: 'option', text: global.lang.ADD_LATER, fa: 'fas fa-clock', id: 'no'})
        }
        let choose = await global.explorer.dialog(opts, def, true)
        if(choose == 'no'){
            return true
        } else if(choose == 'sh') {
            return await this.communityMode()
        } else {
            return await this.input()
        }
    }
    async input(){
        if(this.skipList) return true
        this.active = true
        let err, ret = await global.lists.manager.addListDialog(false).catch(e => err = e)
        console.log('ASKED', ret, global.traceback())
        if(err){
            global.displayErr(global.lang.INVALID_URL_MSG)
            return await this.start()
        }
        return true
    }
    async communityMode(){  
        if(this.skipList) return true 
        let err, ret = await global.lists.manager.communityModeDialog().catch(e => err = e)
        console.warn('communityMode', err, ret)
        if(ret !== true) {
            return await this.start()
        }
    }
    async performance(){
        let ram = await global.diagnostics.checkMemory().catch(console.error)
        if(typeof(ram) == 'number' && (ram / 1024) >= 2048){ // at least 2G of RAM
            return true
        }
        await global.options.performance(true)
        return true
    }
    async countries(){
        let ret = await global.explorer.dialog([
            {template: 'question', fa: 'fas fa-info-circle', text: global.lang.COUNTRIES},
            {template: 'message', text: global.lang.COUNTRIES_THAT_SPEAK_YOUR_LANGUAGE},
            {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok'},
            {template: 'option', text: global.lang.COUNTRIES_HINT, fa: 'fas fa-globe', id: 'countries'}
        ], 'ok')
        if(ret == 'countries'){
            await global.explorer.open(global.lang.OPTIONS +'/'+ global.lang.COUNTRIES)
        }
    }
}

module.exports = Wizard
