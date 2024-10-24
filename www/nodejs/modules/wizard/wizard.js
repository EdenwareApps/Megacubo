import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import options from "../options/options.js";
import lists from "../lists/lists.js";
import diag from "../diagnostics/diagnostics.js";
import config from "../config/config.js"
import paths from '../paths/paths.js'

class Wizard extends EventEmitter {
    constructor() {
        super();
        this.on('restart', () => {
            this.init().catch(console.error);
        });
    }
    isMobile() {
        return !!paths.android;
    }
    async init() {
        if (!lang.isTrusted) {
            await options.showLanguageEntriesDialog();
        }
        await this.lists();
        await this.performance();
        this.active = false;
        config.set('setup-completed', true);
    }
    async lists() {
        this.active = true;
        if (!paths.ALLOW_ADDING_LISTS) {
            if (!config.get('legal-notice-shown')) {
                config.set('legal-notice-shown', true);
                const opts = [
                    { template: 'question', text: lang.LEGAL_NOTICE, fa: 'fas fa-info-circle' },
                    { template: 'message', text: lang.ABOUT_LEGAL_NOTICE },
                    { template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle' }
                ];
                await menu.dialog(opts, 'ok', true);
            }
            return true;
        }
        let text = lang.ASK_IPTV_LIST_FIRST.split('. ').join(".\r\n"), def = 'ok', opts = [
            { template: 'question', text: paths.manifest.window.title, fa: 'fas fa-star' },
            { template: 'message', text },
            { template: 'option', text: lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok' }
        ];
        if (paths.ALLOW_COMMUNITY_LISTS) {
            opts.push({ template: 'option', text: lang.DONT_HAVE_LIST, details: lang.LOAD_COMMUNITY_LISTS, fa: 'fas fa-times-circle', id: 'sh' });
        } else {
            opts.push({ template: 'option', text: lang.ADD_LATER, fa: 'fas fa-clock', id: 'no' });
        }
        let choose = await menu.dialog(opts, def, true);
        if (choose == 'no') {
            return true;
        } else if (choose == 'sh') {
            return await this.communityMode();
        } else {
            return await this.input();
        }
    }
    async input() {
        this.active = true;
        const { manager } = lists;
        let err, ret = await manager.addListDialog(false).catch(e => err = e);
        console.log('ASKED', ret);
        if (typeof(err) != 'undefined') {
            menu.displayErr(lang.INVALID_URL_MSG);
            return await this.lists();
        }
        return true;
    }
    async communityMode() {
        const { manager } = lists;
        let err, ret = await manager.communityModeDialog().catch(e => err = e);
        console.warn('communityMode', err, ret);
        if (ret !== true) {
            return await this.lists();
        }
    }
    async performance() {
        let ram = await diag.checkMemory().catch(console.error);
        if (typeof(ram) == 'number' && (ram / 1024) >= 2048) { // at least 2G of RAM
            return true;
        }
        await options.performance(true);
        return true;
    }
}
export default Wizard;
