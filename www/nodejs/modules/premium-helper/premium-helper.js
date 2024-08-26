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
        renderer.get().emit('open-external-url', 'https://megacubo.net/');
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
            entries.push(this.entry());
        } else if(path) {            
            insertEntry({
                name: lang.RECORDINGS,
                prepend: '<i class="fas fa-star faclr-purple"></i> ',
                type: 'action', side: true,
                fa: 'fas fa-folder',
                action: this.action.bind(this)
            }, entries, 0, [lang.TOOLS, lang.OPTIONS], [lang.MY_LISTS, lang.EPG])
        }
        return entries;
    }
}

try {
    let Premium, rq
    const file = paths.cwd +'/dist/premium'
    const req = file => {
        if(typeof(require) == 'undefined') {
            return createRequire(getFilename())(file)
        }
        return require(file)
    }
    if(fs.existsSync(file +'.js')) {
        Premium = req(file +'.js')        
    } else if(fs.existsSync(file +'.jsc')) {
        Premium = req(file +'.jsc')
    }
    if(Premium) PremiumHelper = Premium
} catch(e) {
    console.error('Premium not loaded: '+ e, e)
}

export default PremiumHelper;
