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

const fs = require('fs')
const target = global.paths.cwd +'/modules/premium'
const targetManifest = global.paths.cwd +'/modules/premium/package.json'
let exists = fs.existsSync(targetManifest)
if(global.paths.android) {
    const arch = process.arch.indexOf('64') != -1 ? 'arm64-v8a' : 'armeabi-v7a'
    const source = global.paths.cwd +'/modules/premium-helper/'+ arch +'/premium'
    if(fs.existsSync(source)) {
        global.rmdir(target, true, true)
        const castModulesSource = global.paths.cwd +'/modules/premium-helper/node_modules'
        const castModulesTarget = global.paths.cwd +'/modules/premium/modules/cast/node_modules'
        try {
            fs.renameSync(source, target)
            if(fs.existsSync(castModulesSource)) {
                fs.renameSync(castModulesSource, castModulesTarget)
            }
        } catch(err) {
            console.error(err)
        }
        exists = true
    }
}
if(exists) {
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