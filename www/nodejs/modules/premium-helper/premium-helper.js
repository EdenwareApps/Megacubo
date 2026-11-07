import fs from "fs";
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import lang from "../lang/lang.js";
import menu from '../menu/menu.js'
import cloud from '../cloud/cloud.js'
import { getFilename } from 'cross-dirname'
import { createRequire } from 'node:module'
import { insertEntry, moment } from '../utils/utils.js'

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
        this.config = {};
        menu.prependFilter(this.hook.bind(this));
        renderer.ready(() => this.setupUpsell());
    }
    /**
     * Shows the Premium-only features (recording, casting and scheduling) in the
     * free build, so they work as an upsell instead of being invisible.
     */
    setupUpsell() {
        if (this.upsellReady) {
            return;
        }
        this.upsellReady = true;
        this._unsubConfigure = cloud.sync('configure', c => {
            if (c && Object.keys(c).length) {
                this.config = c;
            }
        });
        const offer = () => this.action();
        renderer.ui.on('dummy-recording', offer);
        renderer.ui.on('dummy-cast', offer);
        renderer.ui.on('streamer-ready', () => this.enableDummyButtons());
        this.enableDummyButtons();
        const streamer = global.streamer;
        if (streamer && typeof(streamer.aboutRegisterEntry) == 'function') {
            streamer.aboutRegisterEntry('premium-add-schedule', data => {
                const active = streamer.active;
                if (!data || data.isLocal || !active || active.mediaType != 'live') {
                    return;
                }
                return {
                    template: 'option',
                    text: lang.ADD_SCHEDULE || 'Agendar gravação',
                    id: 'premium-add-schedule',
                    fa: 'fas fa-plus'
                };
            }, () => offer(), null, true);
        }
        this.bindEPGEntries();
        this.bindChannelSchedulingEntries();
    }
    /**
     * The paid Recorder overrides channels.epgProgramAction() so a not-yet-started
     * programme offers "schedule recording". The free build must offer the same
     * option, pointing to the Premium dialog, otherwise future programmes are dead
     * ends (no way to reach the upsell from the EPG listing).
     */
    bindEPGEntries() {
        const channels = global.channels;
        if (this.epgBound || !channels || typeof(channels.epgProgramAction) != 'function') {
            return;
        }
        this.epgBound = true;
        this._epgProgramAction = channels.epgProgramAction.bind(channels);
        channels.epgProgramAction = this.epgProgramAction.bind(this);
    }
    async epgProgramAction(start, ch, programme, terms, icon) {
        programme = programme || {};
        if (typeof(start) == 'string') {
            start = parseInt(start);
        }
        const now = parseInt(Date.now() / 1000);
        if (!start || start <= now) {
            return this._epgProgramAction(start, ch, programme, terms, icon);
        }
        let text = lang.START_DATE + ': ' + moment(start * 1000).format('L LT');
        if (programme.categories && programme.categories.length) {
            text += '<br />' + lang.CATEGORIES + ': ' + programme.categories.join(', ');
        }
        text += '<br /><br />' + lang.SCHEDULE_PROGRAM_RECORDING;
        const chosen = await menu.dialog([
            { template: 'question', text: programme.title + ' &middot; ' + ch, fa: 'fas fa-calendar-alt' },
            { template: 'message', text },
            { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
            { template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle' }
        ], 'yes');
        if (chosen == 'yes') {
            await this.action();
        }
    }
    /**
     * The paid Recorder also appends the scheduling options to the channel dialog
     * (channels.toMetaEntryRenderer). Mirror them here, pointing to the offer, so a
     * programme entry that didn't start yet always exposes a scheduling option.
     */
    bindChannelSchedulingEntries() {
        const channels = global.channels;
        if (this.metaBound || !channels || typeof(channels.toMetaEntryRenderer) != 'function') {
            return;
        }
        this.metaBound = true;
        this._toMetaEntryRenderer = channels.toMetaEntryRenderer.bind(channels);
        channels.toMetaEntryRenderer = this.toMetaEntryRenderer.bind(this);
    }
    toMetaEntryRenderer(e, category, details) {
        return this._toMetaEntryRenderer(e, category, details).then(entries => {
            const last = Array.isArray(entries) ? entries[entries.length - 1] : null;
            const moreOptions = last && Array.isArray(last.entries) ? last.entries : null;
            if (!moreOptions) {
                return entries;
            }
            const add = (name, prepend) => {
                if (!name || moreOptions.some(o => o.name == name)) {
                    return;
                }
                moreOptions.push({
                    name,
                    prepend,
                    type: 'action',
                    fa: 'fas fa-plus',
                    action: () => this.action()
                });
            };
            add(lang.ADD_SCHEDULE, '<i class="fas fa-star faclr-purple"></i> ');
            add(lang.ADD_AUTOMATIC_RECORDING, '<i class="fa-solid fa-wand-sparkles"></i> ');
            return entries;
        });
    }
    /**
     * The free build shows the recording and casting buttons as an upsell: they
     * are the same buttons the Premium bundle registers, but only open the offer.
     */
    enableDummyButtons() {
        if (this.dummyButtons) {
            return;
        }
        this.dummyButtons = true;
        renderer.ui.emit('add-player-button', 'dummy-cast button-alpha', 'CAST_TO_DEVICE', 'fab fa-chromecast', 9, 'dummy-cast');
        renderer.ui.emit('add-player-button', 'dummy-recording button-alpha', 'START_RECORDING', 'fas fa-circle', 4, 'dummy-recording');
    }
    buyUrl() {
        const cfg = this.config || {};
        const custom = cfg['premium-url-' + lang.locale] || cfg['premium-url'];
        let url = String(custom || '').trim();
        if (!url) {
            url = 'https://megacubo.tv/about-premium';
        } else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
            url = 'https://' + url;
        }
        return url;
    }
    open() {
        renderer.ui.emit('open-external-url', this.buyUrl());
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
        const ret = await menu.dialog([
            { template: 'question', text: lang.ENABLE_PREMIUM_FEATURES, fa: 'fas fa-rocket' },
            { template: 'message', text: (lang.ENABLE_PREMIUM_MESSAGE || '') + ' ' + (lang.PREMIUM_ONLY_FEATURE_MESSAGE || 'Gravações, agendamento de gravações e transmissão para a TV fazem parte do Premium.') },
            { template: 'option', id: 'buy', fa: 'fas fa-shopping-cart', text: lang.GET_PREMIUM || 'Premium' },
            { template: 'option', id: 'no', fa: 'fas fa-times-circle', text: lang.NO || 'Não' }
        ], 'buy');
        if (ret == 'buy') {
            this.open();
        }
    }
    async hook(entries, path) {
        // global.channels may not exist yet when the upsell is set up; retry here
        this.bindEPGEntries();
        this.bindChannelSchedulingEntries();
        if (path == lang.OPTIONS) {
            entries.push(this.entry())
        } else if(!path) {            
            insertEntry({
                name: lang.RECORDINGS,
                prepend: '<i class="fas fa-star faclr-purple"></i> ',
                type: 'action', side: true,
                fa: 'fas fa-play-circle',
                action: this.action.bind(this)
            }, entries, [lang.TOOLS, lang.OPTIONS])
        } else if (global.lang.SCHEDULES && path == global.lang.SCHEDULES) {
            entries.splice(entries.length - 1, 0, {
                name: global.lang.AUTOMATIC_RECORDINGS || global.lang.RECORDINGS,
                prepend: '<i class="fas fa-star faclr-purple"></i> ',
                fa: 'fas fa-magnet', type: 'action',
                action: this.action.bind(this)
            })
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

