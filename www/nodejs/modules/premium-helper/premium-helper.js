import fs from "fs";
import "bytenode";
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import lang from "../lang/lang.js";
import menu from '../menu/menu.js'
import { getFilename } from 'cross-dirname'
import { createRequire } from 'module'

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
            action: async () => {
                await menu.dialog([
                    { template: 'question', text: lang.ENABLE_PREMIUM_FEATURES, fa: 'fas fa-rocket' },
                    { template: 'message', text: lang.ENABLE_PREMIUM_MESSAGE },
                    { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
                ], 'retry', true);
                this.open();
            }
        };
    }
    async hook(entries, path) {
        if (path == lang.OPTIONS) {
            entries.push(this.entry());
        }
        return entries;
    }
}

try {
    let Premium
    const file = paths.cwd +'/dist/premium'
    if(fs.existsSync(file +'.js')) {
        const require = createRequire(getFilename())
        Premium = require(file +'.js')        
    } else if(fs.existsSync(file +'.jsc')) {
        const require = createRequire(getFilename())
        Premium = require(file +'.jsc')
    }
    if(Premium) PremiumHelper = Premium
} catch(e) {
    console.error('Premium not loaded: '+ e, e)
}

export default PremiumHelper;
