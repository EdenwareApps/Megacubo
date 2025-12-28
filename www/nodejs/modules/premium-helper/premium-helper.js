import fs from "fs";
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import lang from "../lang/lang.js";
import menu from '../menu/menu.js'
import { getFilename } from 'cross-dirname'
import { createRequire } from 'node:module'
import { insertEntry } from '../utils/utils.js'

// Check if bytenode is available at runtime
let bytenodeAvailable = false;
try {
    const req = createRequire(getFilename());
    req('bytenode');
    bytenodeAvailable = true;
    console.log('Bytenode loaded successfully');
} catch (e) {
    console.warn('Bytenode not available:', e.message);
}

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
    const isAndroidArm = process.platform == 'android' && process.arch.startsWith('arm')
    const distFolder = paths.cwd +'/dist/'
    console.log('Premium helper: checking dist folder:', distFolder)
    
    let distFiles;
    try {
        distFiles = new Set(fs.readdirSync(distFolder))
        console.log('Premium helper: dist files found:', Array.from(distFiles).filter(f => f.includes('premium')))
    } catch (e) {
        console.error('Premium helper: cannot read dist folder:', distFolder, e.message)
        throw e
    }
    
    const req = typeof(module) == 'undefined' ? createRequire(getFilename()) : require
    const candidates = ['premium.js']
    if (isAndroidArm) {
        const is64 = process.arch.endsWith('64')
        if(is64) {
            candidates.push('premium-arm64.jsc')
        } else {
            candidates.push('premium-arm.jsc')
        }
    } else {
        candidates.push('premium.jsc')
    }
    
    for(const file of candidates) {
        if(!distFiles.has(file)) {
            console.log('Premium helper: file not found:', file)
            continue
        }
        
        // Skip .jsc files if bytenode is not available
        if(file.endsWith('.jsc') && !bytenodeAvailable) {
            console.warn('Premium helper: skipping', file, '- bytenode not available')
            continue
        }
        
        try {
            console.log('Premium loading: '+ distFolder + file)
            Premium = req(distFolder + file)
            console.log('Premium loaded successfully from:', file)
            break
        } catch(e) {
            console.error('Premium load error for', file + ':', e.message, e.stack)
        }
    }
    if(Premium) {
        PremiumHelper = Premium
        console.log('Premium helper initialized successfully')
    } else {
        console.warn('Premium helper: no premium module could be loaded')
    }
} catch(e) {
    console.error('Premium not loaded: '+ e.message, e.stack)
}

export default PremiumHelper;

