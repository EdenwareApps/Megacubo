class PremiumHelper {
    constructor(){
        global.menu.prependFilter(this.hook.bind(this))
    }
    open(){
        global.renderer.emit('open-external-url', 'https://megacubo.net/')
    }
    entry(){
        return {
            name: global.lang.ENABLE_PREMIUM_FEATURES,
            type: 'action',
            fa: 'fas fa-rocket',
            action: async () => {
                await global.menu.dialog([
                    {template: 'question', text: global.lang.ENABLE_PREMIUM_FEATURES, fa: 'fas fa-rocket'},
                    {template: 'message', text: global.lang.ENABLE_PREMIUM_MESSAGE},
                    {template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK'}
                ], 'retry', true)
                this.open()
            }
        }
    }
    async hook(entries, path){
        if(path == global.lang.OPTIONS){
            entries.push(this.entry())
        }
        return entries
    }
}

if(require('fs').existsSync(global.paths.cwd +'/modules/premium')){
	require('bytenode')
    try {
        let _PremiumHelper = require('../premium/premium')
        if(_PremiumHelper) {
            PremiumHelper = _PremiumHelper
        }
    } catch(e) {
        console.error(e)
    }
}

module.exports = PremiumHelper