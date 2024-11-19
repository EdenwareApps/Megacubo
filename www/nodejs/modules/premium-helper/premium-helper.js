import fs from "fs";
import "bytenode";
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import lang from "../lang/lang.js";
import menu from '../menu/menu.js'
import { getFilename } from 'cross-dirname'
import { createRequire } from 'module'
import { insertEntry } from '../utils/utils.js'

class PremiumHelper {
    constructor() {
        menu.prependFilter(this.hook.bind(this));
    }
    open() {
        renderer.ui.emit('open-external-url', 'https://megacubo.net/');
    }
    entry() {
        return {
            name: lang.ENABLE_PREMIUM_FEATURES,
            type: 'action',
            fa: 'fas fa-rocket',
            action: this.action.bind(this)
        };
    }
    async action() {
        await menu.dialog([
            { template: 'question', text: lang.ENABLE_PREMIUM_FEATURES, fa: 'fas fa-rocket' },
            { template: 'message', text: lang.ENABLE_PREMIUM_MESSAGE },
            { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
        ], 'retry', true);
        this.open()
    }
    async hook(entries, path) {
        if (path == lang.OPTIONS) {
            entries.push(this.entry())
        } else if(!path) {            
            insertEntry({
                name: lang.RECORDINGS,
                prepend: '<i class="fas fa-star faclr-purple"></i> ',
                type: 'action', side: true,
                fa: 'fas fa-folder',
                action: this.action.bind(this)
            }, entries, [lang.TOOLS, lang.OPTIONS])
        }
        return entries;
    }
}

try {
    let Premium
    const is64 = process.arch.endsWith('64')
    const distFolder = paths.cwd +'/dist/'
    const distFiles = new Set(fs.readdirSync(distFolder))
    const r = typeof(module) == 'undefined' ? createRequire(getFilename()) : require
    const candidates = ['premium.js', is64 ? 'premium-arm64.jsc' : 'premium-arm.jsc', 'premium.jsc']
    for(const file of candidates) {
        if(!distFiles.has(file)) continue
        try {
            console.log('Premium loading: '+ distFolder + file)
            Premium = r(distFolder + file)
            console.log('Premium loaded')
            break
        } catch(e) {
            console.error('Premium load error: '+ e)
        }
    }
    if(Premium) PremiumHelper = Premium
} catch(e) {
    console.error('Premium not loaded: '+ e, e)
}

export default PremiumHelper;
