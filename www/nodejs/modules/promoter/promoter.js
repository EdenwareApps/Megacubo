import Download from '../download/download.js'
import osd from '../osd/osd.js'
import streamer from "../streamer/main.js";
import options from "../options/options.js";
import cloud from "../cloud/cloud.js";
import lang from "../lang/lang.js";
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import menu from '../menu/menu.js'

class Promoter {
    constructor() {
        if (!this.originalApplyFilters) {
            this.originalApplyFilters = menu.applyFilters.bind(menu);
            menu.applyFilters = this.applyFilters.bind(this);
        }
        this.startTime = (Date.now() / 1000);
        this.promoteDialogTime = 0;
        this.promoteDialogInterval = 1800;
        renderer.get().on('video-error', () => this.promoteDialogSignal());
        renderer.get().on('streamer-is-slow', () => this.promoteDialogSignal());
        streamer.on('hard-failure', () => this.promoteDialogSignal());
        streamer.on('stop', () => this.promoteDialog());
    }
    async promoteDialog() {
        const now = (Date.now() / 1000);
        if (this.promoteDialogPending !== true)
            return;
        // small delay to check if it will not load other stream right after
        process.nextTick(() => {
            if (this.promoteDialogPending !== true)
                return;
            if ((now - this.promoteDialogTime) < this.promoteDialogInterval)
                return;
            
            if (streamer.active || streamer.isTuning())
                return;
            const runningTime = now - this.startTime;
            if (runningTime < 30)
                return;
            this.promoteDialogTime = now;
            this.promoteDialogPending = false;
            this.offer('dialog').then(a => a && this.dialogOffer(a)).catch(console.error);
        });
    }
    async promoteDialogSignal() {
        this.promoteDialogPending = true;
        this.promoteDialog().catch(console.error);
    }
    async offer(type, skipRequirements) {
        const atts = {
            communitary: config.get('communitary-mode-lists-amount') > 0,
            premium: options.prm(true),
            country: lang.countryCode,
            platform: process.platform,
            version: paths.manifest.version
        };
        const c = await cloud.get('promos');
        if (!Array.isArray(c))
            return;
        const promos = c.filter(p => {
            if (p.type != type)
                return;
            return Object.keys(atts).every(k => {
                if (skipRequirements && skipRequirements.includes(k)) {
                    return true;
                }
                else if (k == 'country') {
                    return typeof (p.countries) == 'undefined' || p.countries.includes(atts[k]);
                }
                else if (k == 'platform') {
                    return typeof (p.platforms) == 'undefined' || p.platforms.includes(atts[k]);
                }
                else if (k == 'version') {
                    return typeof (p.minVersion) == 'undefined' || atts.version >= p.minVersion;
                }
                else {
                    return typeof (p[k]) == 'undefined' || p[k] == atts[k];
                }
            });
        });
        if (promos.length) {
            return promos.shift();
        }
    }
    async dialogOffer(a) {
        this.promoteDialogShown = true;
        const text = a.description;
        let callbacks = {}, opts = [
            { template: 'question', text: a.title, fa: a.fa },
            { template: 'message', text }
        ];
        opts.push(...a.opts.map((o, i) => {
            const id = 'opt-' + i;
            callbacks[id] = async () => {
                if (!o.url)
                    return;
                if (o.url.indexOf('{email}') != -1) {
                    const email = await menu.prompt({
                        question: o.emailPrompt || '',
                        placeholder: o.emailPlaceholder || '',
                        fa: o.fa
                    });
                    o.url = o.url.replace('{email}', encodeURIComponent(email || ''));
                }
                if (o.url.indexOf('{name}') != -1) {
                    const name = await menu.prompt({
                        question: o.namePrompt || '',
                        placeholder: o.namePlaceholder || '',
                        fa: o.fa
                    });
                    o.url = o.url.replace('{name}', encodeURIComponent(name || ''));
                }
                if (o.confirmation) {
                    osd.show(lang.PROCESSING, 'fas fa-circle-notch fa-spin', 'promoter', 'persistent');
                    Download.get({
                        url: o.url,
                        retries: 10
                    }).then(() => {
                        menu.info(o.name, o.confirmation);
                    }).catch(e => menu.displayErr(e)).finally(() => {
                        osd.hide('promoter');
                    });
                }
                else {
                    renderer.get().emit('open-external-url', o.url);
                }
            };
            return {
                template: 'option',
                text: o.name,
                details: o.details,
                id,
                fa: o.fa
            };
        }));
        const id = await menu.dialog(opts);
        if (typeof (callbacks[id]) == 'function')
            await callbacks[id]();
    }
    async applyFilters(entries, path) {
        entries = await this.originalApplyFilters(entries, path);
        if (Array.isArray(entries) && entries.length) {
            const chosen = entries[0].type == 'back' ? 1 : 0;
            entries = entries.filter(e => e.hookId != 'promoter');
            entries.forEach((e, i) => {
                if (!e.top && e.class && e.class.indexOf('entry-2x') != -1) {
                    entries[i].class = e.class.replace(new RegExp('(entry-2x|entry-cover|entry-force-cover)', 'g'), '');
                }
            });
            if (!path) { // move entries with icon to top on home
                const orderHint = ['history', 'epg-history', 'watching'];
                const hasProgrammeIcon = e => e.programme && e.programme.i;
                const hasProgramme = e => e.programme && e.programme.t;
                const hasIcon = e => e.icon && !e.icon.startsWith('http://127.0.0.1:');
                const getScore = e => {
                    let score = 0;
                    if (!e.top) {
                        const p = hasProgramme(e), c = hasIcon(e);
                        if (hasProgrammeIcon(e))
                            score += 1000;
                        else if (p && c)
                            score += 100;
                        else if (c)
                            score += 10;
                        const i = e.hookId ? orderHint.indexOf(e.hookId) : -1;
                        if (i >= 0)
                            score -= i; // subtract instead of sum, sorting helper
                    }
                    return score;
                };
                let max;
                const promo = await this.offer('stream');
                entries.forEach((e, i) => {
                    if (e.top || (promo && e.hookId == 'watching'))
                        return;
                    const score = getScore(e);
                    if (score >= 7 && (!max || score > max.score)) {
                        max = { i, score };
                    }
                });
                if (max && max.i >= 0) {
                    const n = entries[max.i];
                    entries.splice(max.i, 1);
                    entries.unshift(n);
                }
                else if (promo) {
                    const a = entries.findIndex(e => e.name == promo.name);
                    const i = entries.findIndex(e => e.name == lang.KEEP_WATCHING);
                    if (promo && a == -1 && i != -1) {
                        const n = entries[i];
                        entries.splice(i, 1);
                        delete n.renderer;
                        entries.unshift(Object.assign(n, promo));
                    }
                }
            }
            if (entries[chosen]) {
                const hasIcon = entries[chosen].icon || (entries[chosen].programme && entries[chosen].programme.i);
                if (!path || entries.length == (chosen + 1) || hasIcon) {
                    if (typeof (entries[chosen].class) == 'undefined') {
                        entries[chosen].class = '';
                    }
                    entries[chosen].class += ' entry-2x';
                    if (hasIcon || !path) {
                        entries[chosen].class += ' entry-cover entry-force-cover';
                    }
                }
            }
        }
        return entries;
    }
}

export default new Promoter()