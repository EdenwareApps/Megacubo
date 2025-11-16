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
            this.init().catch(err => {
                console.error('Wizard initialization failed:', err.message || err)
            });
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
        // Only mark as completed if there are actually lists configured
        const hasLists = (config.get('lists') && config.get('lists').length) || config.get('communitary-mode-lists-amount') || config.get('public-lists') === 'only';
        if (hasLists) {
            config.set('setup-completed', true);
        } else {
            config.set('setup-completed', false);
        }
    }
    async lists() {
        this.active = true;
		const waitForAutoRetry = async () => {
			const manager = lists?.manager;
			const shouldDelay = () => {
				const current = manager?.noListsAutoRetryState;
				if (!current || current.exhausted) {
					return false;
				}
				return Boolean(current.timer || current.awaitingResult || current.attempts === 0);
			};
			if (!shouldDelay()) {
				return;
			}
			await new Promise(resolve => {
				let finished = false;
				const cleanup = () => {
					if (finished) return;
					finished = true;
					clearTimeout(maxWait);
					clearInterval(tick);
					if (typeof lists.off === 'function') {
						lists.off('state', onState);
					} else if (typeof lists.removeListener === 'function') {
						lists.removeListener('state', onState);
					}
					resolve();
				};
				const check = () => {
					if (!shouldDelay() || lists.loaded()) {
						cleanup();
					}
				};
				const onState = info => {
					if (info?.length) {
						cleanup();
					} else {
						check();
					}
				};
				const tick = setInterval(check, 200);
				const maxWait = setTimeout(cleanup, 4000);
				if (typeof lists.on === 'function') {
					lists.on('state', onState);
				}
				check();
			});
		};
		await waitForAutoRetry();
		if (lists.loaded(true)) {
			return true;
		}
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
            return this.communityMode();
        } else {
            return this.input();
        }
    }
    async input() {
        this.active = true;
        const { manager } = lists;
        let err, ret = await manager.addListDialog(false).catch(e => err = e);
        console.log('ASKED', ret);
        if (typeof(err) != 'undefined') {
            menu.displayErr(lang.INVALID_URL_MSG);
            return this.lists();
        }
        return true;
    }
    async communityMode() {
        const { manager } = lists;
        let err, ret = await manager.communityModeDialog().catch(e => err = e);
        console.warn('communityMode', err, ret);
        if (ret !== true) {
            return this.lists();
        }
        return ret;
    }
    async performance() {
        let ram = await diag.checkMemory().catch(err => {
            console.error('Memory check failed:', err.message || err)
            return null
        });
        if (typeof(ram) == 'number' && (ram / 1024) >= 2048) { // at least 2G of RAM
            return true;
        }
        await options.performance(true);
        return true;
    }
}
export default Wizard;
