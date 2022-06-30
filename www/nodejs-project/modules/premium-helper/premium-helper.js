
class PremiumHelper {
    constructor(){
        global.explorer.prependFilter(this.hook.bind(this))
    }
    open(){
        global.ui.emit('open-external-url', 'https://megacubo.net/')
    }
    entry(){
        return {
            name: global.lang.ENABLE_PREMIUM_FEATURES,
            type: 'action',
            fa: 'fas fa-rocket',
            action: async () => {
                await global.explorer.dialog([
                    {template: 'question', text: global.lang.ENABLE_PREMIUM_FEATURES, fa: 'fas fa-rocket'},
                    {template: 'message', text: global.lang.ENABLE_PREMIUM_MESSAGE},
                    {template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK'}
                ], 'retry', true)
                this.open()
            }
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == global.lang.OPTIONS){
                entries.push(this.entry())
            }
            resolve(entries)
        })
    }
}

if(require('fs').existsSync(global.APPDIR + '/modules/premium')){
	require('bytenode')
    try {
        let _PremiumHelper = require(global.APPDIR + '/modules/premium/premium')
        if(_PremiumHelper){
            PremiumHelper = _PremiumHelper
        }
    } catch(e) {
        console.error(e)
    }
}

module.exports = PremiumHelper

