import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import options from "../options/options.js";
import lists from "../lists/lists.js";
import diag from "../diagnostics/diagnostics.js";
import config from "../config/config.js"
import paths from '../paths/paths.js'
import renderer from '../bridge/bridge.js'

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
        // Reset completion so interrupted/closed wizard does not mark setup complete prematurely.
        config.set('setup-completed', false);
        if (!lang.isTrusted) {
            await options.showLanguageEntriesDialog();
        }
        await this.lists();
        await this.performance();
        this.active = false;
        // setup-completed is now handled after loading results
    }
    async lists() {
        this.active = true;

        // SCREEN 1: Welcome
        await this.showWelcomeScreen();

        // SCREEN 2: Mode selection
        const mode = await this.showModeSelection();
        if (!mode) {
            // User canceled, go back to the beginning
            return this.lists();
        }

        // SCREEN 3: Confirmation (only for public lists)
        if (mode === 'public' && !(await this.confirmPublicMode())) {
            return this.lists(); // go back to selection
        }

        // SCREEN 4: Configure initial state (firestarter!)
        await this.configureInitialState(mode);

        // SCREEN 5: Loading / preparation
        await this.showLoadingScreen(mode);

        // Mark setup completed only if lists are effectively loaded
        const hasLoadedLists = lists.loaded(true);
        config.set('setup-completed', Boolean(hasLoadedLists));

        return Boolean(hasLoadedLists);
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

    async showWelcomeScreen() {
        if (this.welcomeScreenShown) {
            return true;
        }
        this.welcomeScreenShown = true;
        const opts = [
            { template: 'question', text: lang.WELCOME_TO_MEGACUBO, fa: 'fas fa-star' },
            { template: 'message', text: lang.WELCOME_MESSAGE },
            { template: 'option', text: lang.CONTINUE, id: 'continue', fa: 'fas fa-arrow-right' }
        ];
        const result = await menu.dialog(opts, 'continue', true);
        if (!result) {
            // User canceled, try again
            return this.showWelcomeScreen();
        }
        return result;
    }

    async showModeSelection() {
        const opts = [
            { template: 'question', text: lang.MODE_SELECTION_TITLE, fa: 'fas fa-question-circle' },
            // Option 1: Community lists (featured)
            { template: 'option', text: lang.COMMUNITY_MODE_TITLE, details: lang.COMMUNITY_MODE_DESC, id: 'community', fa: 'fas fa-users' },
            // Option 2: Own list (encouraged)
            { template: 'option', text: lang.OWN_LIST_MODE_TITLE, details: lang.OWN_LIST_MODE_DESC, id: 'own-list', fa: 'fas fa-plus-square' },
            // Option 3: Public lists (less prominent)
            { template: 'option', text: lang.PUBLIC_MODE_TITLE, details: lang.PUBLIC_MODE_DESC, id: 'public', fa: 'fas fa-globe' }
        ];
        const choice = await menu.dialog(opts, 'community', true);
        return choice;
    }

    async confirmPublicMode() {
        const opts = [
            { template: 'question', text: lang.PUBLIC_MODE_WARNING, fa: 'fas fa-exclamation-triangle' },
            { template: 'message', text: lang.PUBLIC_MODE_WARNING_DESC },
            { template: 'option', text: lang.BACK, id: 'back', fa: 'fas fa-arrow-left' },
            { template: 'option', text: lang.CONTINUE_ANYWAY, id: 'continue', fa: 'fas fa-check-circle' }
        ];
        const choice = await menu.dialog(opts, 'back', true);
        if (!choice) {
            // User canceled, treat as "don't continue"
            return false;
        }
        return choice === 'continue';
    }

    async showLoadingScreen(mode) {
        this.currentMode = mode; // Store current mode for waitForAutoRetry
        const messages = {
            community: lang.PREPARING_STREAMS,
            'own-list': lang.READY_FOR_LIST,
            public: lang.LOADING_PUBLIC
        };

        // For own-list, no loading needed, it's already ready
        if (mode === 'own-list') {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure dialog shows after other dialogs close

        const opts = [
            { template: 'question', text: messages[mode], fa: 'fas fa-spinner fa-spin' },
            { template: 'message', text: lang.WAIT_MOMENT }
        ];

        // Show dialog and wait for loading
        const loadingPromise = (async () => {
            if (mode === 'community') {
                const timeoutMs = 15000;
                const waitForReady = async () => {
                    if (lists.loaded(true)) {
                        return;
                    }
                    await this.waitForAutoRetry();
                };
                await Promise.race([
                    waitForReady(),
                    new Promise(resolve => setTimeout(resolve, timeoutMs))
                ]);
            } else if (mode === 'public') {
                config.set('public-lists', 'only');
            }
        })();

        const loadingId = 'wizard-loading';
        const promises = [
            loadingPromise,
            new Promise(resolve => setTimeout(resolve, 1000)) // Ensure at least 1 second of loading screen for better UX
        ];

        menu.dialog(opts, 'loading', true, loadingId);
        try {
            await Promise.allSettled(promises);
        } finally {
            // Close dialog after loading (always attempt to close)
            renderer.ui.emit('dialog-close', loadingId);
            console.info('[wizard] showLoadingScreen done, closed', loadingId);
        }
    }

    async configureInitialState(mode) {
        const { manager } = lists;

        switch (mode) {
            case 'community':
                // Enable community mode
                renderer.ui.localEmit('lists-manager', 'agree');
                break;
            case 'own-list':
                // Request list from user immediately
                try {
                    await manager.addListDialog(false);
                } catch (err) {
                    console.error('Failed to add list:', err);
                    menu.displayErr(lang.INVALID_URL_MSG);
                    // If it fails, return to start to ask mode again
                    return this.lists();
                }
                break;
            case 'public':
                // Already configured in loading screen
                break;
        }

        // Do not mark setup complete here. finish state is set after loading screen based on actual loaded lists.
        // This avoids prematurely marking setup complete if user closes app before completing wizard.
        config.set('setup-completed', false);
    }

    async waitForAutoRetry() {
        // FIX: For community mode, always show progress even if lists are already loaded
        // For other modes, skip if already loaded
        if (this.currentMode !== 'community' && lists?.loaded(true)) {
            return;
        }

        const startTime = Date.now();
        // Reuse existing waitForAutoRetry logic
        const shouldDelay = () => {
            const current = lists?.manager?.noListsAutoRetryState;
            if (!current || current.exhausted) {
                return false;
            }
            // Don't wait if lists are already loaded
            if (lists.loaded(true)) {
                return false;
            }
            // Always stop after 30s wall-clock to avoid indefinite loop
            if (Date.now() - startTime > 30000) {
                return false;
            }
            return Boolean(current.timer || current.awaitingResult || current.attempts === 0);
        };

        const should = shouldDelay();
        if (!should) {
            return;
        }

        await new Promise(resolve => {
            let finished = false;
            const cleanup = () => {
                if (finished) return;
                finished = true;
                clearInterval(tick);
                lists.removeListener('state', onState);
                resolve();
            };

            const check = () => {
                if (!shouldDelay() || lists.loaded(true)) {
                    cleanup();
                }
            };

            const onState = info => {
                if (info.length &&lists.satisfied) {
                    cleanup();
                }
            };

            const tick = setInterval(check, 500);
            lists.on('state', onState);
            check();
        });
    }
}
export default Wizard;
