class AutoConfig {
    constructor(){}
    validateDomain(domain){
        return domain.indexOf('.') != -1 && domain.match(new RegExp('^[a-z0-9\.]{4,}'))
    }
    async start(_data){
        let data = _data || (await this.detect())
        if(_data || (data && data.domain && this.validateDomain(data.domain))){
            global.ui.emit('setup-skip-list')
            let allow = await this.confirm(data.domain)
            if(allow){
                this.apply(data)
                return true
            } else {
                if(!lists.manager.get().length && !global.config.get('communitary-mode-lists-amount')){
                    global.config.set('setup-completed', false)
                    global.ui.emit('setup-restart')
                }                
            }
        }
    }
    async detect(){
        return await global.Download.promise({
            url: global.cloud.server +'/configure/auto',
            responseType: 'json'
        })
    }
    async confirm(domain){
        let opts = [
            {template: 'question', text: global.lang.AUTOCONFIG, fa: 'fas fa-magic'},
            {template: 'message', text: global.lang.AUTOCONFIG_WARN.format(domain || '').replace('()', '')},
            {template: 'option', text: global.lang.ALLOW, fa: 'fas fa-check-circle', id: 'yes'},
            {template: 'option', text: global.lang.BLOCK, fa: 'fas fa-ban', id: 'no'}
        ], def = 'no'
        let ret = await global.explorer.dialog(opts, def)
        return ret == 'yes'
    }
    async confirmDisableLists(){
        let opts = [
            {template: 'question', text: global.lang.AUTOCONFIG, fa: 'fas fa-magic'},
            {template: 'message', text: global.lang.PROVIDER_DISABLE_LISTS},
            {template: 'option', text: global.lang.CONFIRM, fa: 'fas fa-check-circle', id: 'yes'},
            {template: 'option', text: global.lang.SKIP, fa: 'fas fa-times-circle', id: 'no'}
        ], def = 'no'
        let ret = await global.explorer.dialog(opts, def)
        return ret == 'yes'
    }
    async confirmDisableParentalControl(){
        let opts = [
            {template: 'question', text: global.lang.AUTOCONFIG, fa: 'fas fa-magic'},
            {template: 'message', text: global.lang.PROVIDER_DISABLE_PARENTAL_CONTROL},
            {template: 'option', text: global.lang.CONFIRM, fa: 'fas fa-check-circle', id: 'yes'},
            {template: 'option', text: global.lang.SKIP, fa: 'fas fa-times-circle', id: 'no'}
        ], def = 'no'
        let ret = await global.explorer.dialog(opts, def)
        return ret == 'yes'
    }
    shouldApplyM3U(data){ // prevent second dialog to show, if possible
        if(data.unique && global.config.get('communitary-mode-lists-amount')){
            return true
        }
        let lists = global.lists.manager.get()
        return lists.length != 1 || lists[0][1] != data.m3u
    }
    shouldConfirmDisableParentalControl(v){ // prevent second dialog to show, if possible
        return global.config.get('parental-control') != v
    }
    shouldConfirmDisableLists(data){ // prevent second dialog to show, if possible
        if(global.config.get('communitary-mode-lists-amount')){
            return true
        }
        let lists = global.lists.manager.get()
        return lists.some(l => l[1] != data.m3u)
    }
    async apply(data){
        console.log('autoConfigure', data)
        if(data['m3u'] && this.shouldApplyM3U(data)){
            console.log('autoConfigure', data['m3u'])
            global.ui.emit('setup-skip-list') // skip asking list on setup dialog
            if(data['unique'] && this.shouldConfirmDisableLists(data)){
                let unique = await this.confirmDisableLists()
                global.lists.manager.addList(data['m3u'], data['m3u_name'], unique).catch(console.error)
                if(unique){
                    global.config.set('communitary-mode-lists-amount', 0)
                    global.explorer.refresh()
                }
            } else {
                global.lists.manager.addList(data['m3u'], data['m3u_name']).catch(console.error)
            }
        }
        if(data['parental-control'] && global.config.get('parental-control') != data['parental-control']){
            console.log('autoConfigure', data['parental-control'])
            let proceed = data['parental-control'] == 'block' || (await this.confirmDisableParentalControl(data['parental-control']))
            if(proceed){
                global.config.set('parental-control', data['parental-control'])
                global.explorer.refresh()
            }
        }
        if(data['epg'] && data['epg'] != global.config.get('epg-'+ global.lang.locale)){
            global.epgSetup = true
            console.log('autoConfigure', data['epg'])
            global.config.set('epg-'+ global.lang.locale, data['epg'])
            global.lists.manager.setEPG(data['epg'], true)
            if(data['use-epg-channels-list']){
                if(global.activeEPG == data['epg']){
                    global.lists.manager.importEPGChannelsList(global.activeEPG).catch(console.error)
                }
            }
        }
        if(data['theme']){
            global.theme.applyRemoteTheme(data['theme'], data['theme-name'])
        }
        if(data['config-server'] && global.validateURL(data['config-server'])){ // as last one
            global.config.set('config-server', data['config-server'])
            global.options.clearCache()
        }
    }    
}

module.exports = AutoConfig
