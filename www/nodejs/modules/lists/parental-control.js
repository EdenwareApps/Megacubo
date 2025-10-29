import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import cloud from "../cloud/cloud.js";
import crypto from 'crypto'
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'                                     
                                        
class ParentalControl extends EventEmitter {
    constructor() {
        super();
        this.authTTL = 600;
        this.termsRegex = false;
        this.on('updated', () => {
            process.nextTick(() => menu.refreshNow())
        })
        config.on('change', keys => {
            if(keys.includes('parental-control-terms')) {
                this.setTerms();
            }
            if(keys.includes('parental-control')) {
                const currentType = config.get('channel-grid');
                if (data['parental-control'] == 'only') {
                    if(currentType != 'xxx') {
                        config.set('channel-grid-prev', currentType);
                        config.set('channel-grid', 'xxx');
                    }
                } else {
                    if(currentType == 'xxx') {
                        const prev = config.get('channel-grid-prev');
                        config.set('channel-grid', prev || '');
                    }
                }
            }
        });
        this.setupTerms();
        renderer.ready && renderer.ready(() => this.update());
    }
    entry() {
        return {
            name: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt', type: 'group',
            renderer: async () => {
                let def = config.get('parental-control'), blocked = ['block', 'remove'].includes(def);
                let opts = [
                    {
                        details: lang.BLOCK + ' | ' + lang.ALLOW,
                        name: lang.ADULT_CONTENT,
                        fa: blocked ? 'fas fa-lock' : 'fas fa-lock-open',
                        type: 'select',
                        safe: true,
                        renderer: async () => {
                            await this.auth();
                            let options = [
                                {
                                    key: 'remove',
                                    fa: 'fas fa-trash'
                                },
                                {
                                    key: 'block',
                                    fa: 'fas fa-lock'
                                },
                                {
                                    key: 'allow',
                                    fa: 'fas fa-lock-open'
                                },
                                {
                                    key: 'only',
                                    fa: 'fas fa-fire'
                                }
                            ].map(n => {
                                let name;
                                if (n.key == 'block') {
                                    name = lang.ASK_PASSWORD;
                                } else {
                                    name = lang[n.key.replaceAll('-', '_').toUpperCase()];
                                }
                                return {
                                    name,
                                    value: n.key,
                                    icon: n.fa,
                                    type: 'action',
                                    safe: true,
                                    action: async () => {
                                        await this.auth();
                                        if (['block', 'remove'].includes(n.key)) {
                                            let fine = !!config.get('parental-control-pw');
                                            if (!fine) {
                                                fine = await this.setupAuth().catch(err => console.error(err));
                                            }
                                            if (fine === true) {
                                                config.set('parental-control', n.key);
                                                if (this.authenticated) {
                                                    delete this.authenticated;
                                                }
                                            }
                                        } else {
                                            config.set('parental-control-pw', '');
                                            config.set('parental-control', n.key);

                                            if (this.authenticated) {
                                                delete this.authenticated;
                                            }
                                        }
                                        osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal');
                                        this.emit('updated')
                                    }
                                };
                            });
                            options = options.map(p => {
                                p.selected = (def == p.value);
                                return p;
                            });
                            return options;
                        }
                    }
                ];
                if (config.get('parental-control') != 'allow') {
                    opts.push({
                        name: lang.FILTER_WORDS,
                        details: lang.SEPARATE_WITH_COMMAS,
                        type: 'input',
                        fa: 'fas fa-shield-alt',
                        action: async (e, v) => {
                            if (v !== false && await this.auth()) {
                                config.set('parental-control-terms', v);
                                this.setTerms();
                            }
                        },
                        value: () => {
                            return config.get('parental-control-terms');
                        },
                        placeholder: lang.FILTER_WORDS,
                        multiline: true,
                        safe: true
                    });
                    
                    // Age rating control
                    opts.push({
                        name: lang.AGE_RATING_MAXIMUM,
                        details: lang.AGE_RATING_DESCRIPTION,
                        type: 'select',
                        fa: 'fas fa-calendar-alt',
                        safe: true,
                        renderer: async () => {
                            await this.auth();
                            const currentAge = config.get('parental-control-age', 0);
                            const options = [
                                { name: lang.AGE_RATING_0_PLUS, value: 0, fa: 'fas fa-check-circle' },
                                { name: lang.AGE_RATING_7_PLUS, value: 7, fa: 'fas fa-child' },
                                { name: lang.AGE_RATING_12_PLUS, value: 12, fa: 'fas fa-user' },
                                { name: lang.AGE_RATING_13_PLUS, value: 13, fa: 'fas fa-user-friends' },
                                { name: lang.AGE_RATING_16_PLUS, value: 16, fa: 'fas fa-user-tie' },
                                { name: lang.AGE_RATING_18_PLUS, value: 18, fa: 'fas fa-user-secret' }
                            ].map(opt => ({
                                ...opt,
                                selected: currentAge === opt.value,
                                type: 'action',
                                action: async () => {
                                    await this.auth();
                                    config.set('parental-control-age', opt.value);
                                    this.emit('updated');
                                    osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal');
                                }
                            }));
                            return options;
                        }
                    });
                }
                return opts;
            }
        };
    }
    setupTerms(tms) {
        this.terms = this.keywords(tms || config.get('parental-control-terms') || '');
        if (this.terms.length) {
            // Escape backslashes first, then other special characters
            const rgx = this.terms
                .map(term => term.replace(/\\/g, '\\\\')) // Escape backslashes
                .join('|')
                .replace(/\+/g, '\\+') // Escape +
                .replace(/[\^\$]/g, '(\\b|\\W)') // Escape ^ and $
            try {
                this.termsRegex = new RegExp(rgx, 'i')
            } catch (err) {
                console.error('Parental control terms invalid regex: '+ rgx, err);
            }
        } else {
            this.termsRegex = false;
        }
    }
    setTerms(terms) {
        if(terms === undefined) { // reload from config
            terms = config.get('parental-control-terms')
        }
        if (typeof(terms) == 'string') {
            this.terms = this.keywords(terms);
        } else if (!Array.isArray(terms)) {
            console.error('Bad terms format', terms);
            return;
        }
        this.terms = [...new Set(this.terms)] // make unique
        let sterms = this.terms.join(',');
        config.set('parental-control-terms', sterms);
        this.setupTerms(sterms);
        this.emit('updated');
    }
    update() {
        if (config.get('parental-control-terms') == config.defaults['parental-control-terms']) { // update only if the user didn't customized
            cloud.get('configure').then(c => {
                if (c && c.adultTerms) {
                    this.setTerms(c.adultTerms);
                }
            }).catch(err => {
                console.error(err);
                setTimeout(() => this.update(), 10000);
            });
        }
    }
    keywords(str) {
        return str.toLowerCase().split(',').filter(t => {
            return t.length >= 2;
        });
    }
    has(stack) {
        return this.termsRegex ? stack.match(this.termsRegex) : false;
    }
    allow(entry) {
        if (typeof(entry) == 'string') {
            return !this.has(entry);
        }
        if (entry.type && !['group', 'stream'].includes(entry.type)) {
            return true;
        }
        
        // Enhanced parental control with age rating support
        let str, allow = true;
        str = entry.name;
        if (entry.group) {
            str += ' ' + entry.group;
        }
        
        // Check age rating first (highest priority)
        if (entry.age !== undefined && entry.age > 0) {
            const parentalControlAge = config.get('parental-control-age', 0);
            if (entry.age > parentalControlAge) {
                allow = false;
            }
        }
        
        // Check traditional terms-based blocking
        if (str && this.has(str)) {
            allow = false;
        }
        
        return allow;
    }
    filter(entries, skipProtect) {
        if (entries.length) {
            switch (config.get('parental-control')) {
                case 'remove':
                    entries = entries.filter(this.allow.bind(this));
                    break;
                case 'block':
                    if (!skipProtect) {
                        entries = entries.map(e => this.allow(e) ? e : this.protect(e));
                    }
                    break;
            }
            if (entries.entries && Array.isArray(entries.entries)) {
                entries.entries = this.filter(entries.entries, skipProtect);
            }
        }
        return entries;
    }
    md5(txt) {
        return crypto.createHash('md5').update(txt).digest('hex');
    }
    lazyAuth() {
        if (this.authenticated) {
            return true;
        } else {
            return ['allow', 'only'].includes(config.get('parental-control'));
        }
    }
    async auth() {
        const now = (Date.now() / 1000);
        if ((!this.authenticated || now > this.authenticated) && ['block', 'remove'].includes(config.get('parental-control')) && config.get('parental-control-pw')) {
            const pass = await menu.prompt({
                question: lang.PASSWORD,
                fa: 'fas fa-key',
                isPassword: true
            });
            if (pass && this.md5(pass) == config.get('parental-control-pw')) {
                this.authenticated = now + this.authTTL;
                return true;
            } else {
                menu.displayErr(lang.PASSWORD_NOT_MATCH);
                throw lang.PASSWORD_NOT_MATCH;
            }
        } else {
            return true;
        }
    }
    async setupAuth() {
        const pass = await menu.prompt({
            question: lang.CREATE_YOUR_PASS,
            fa: 'fas fa-key',
            isPassword: true
        });
        if (pass) {
            const pass2 = await menu.prompt({
                question: lang.TYPE_PASSWORD_AGAIN,
                fa: 'fas fa-key',
                isPassword: true
            });
            if (pass === pass2) {
                config.set('parental-control-pw', this.md5(pass));
                return true;
            }
        }
        await menu.dialog([
            { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-exclamation-triangle' },
            { template: 'message', text: lang.PASSWORD_NOT_MATCH },
            { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
        ], 'parental-control', true);
    }
    protect(e) {
        if (e.class && e.class.includes('parental-control-protected')) {
            return e;
        }
        const action = async () => {
            let allow = await this.auth().catch(err => console.error(err));
            if (allow === true) {
                menu.emit('action', e);
            }
        };
        const entry = Object.assign(Object.assign({}, e), { action, class: 'parental-control-protected allow-stream-state', type: 'action', icon: undefined, fa: 'fas fa-lock' });
        return entry;
    }
    only(entries) {
        if (entries.length) {
            entries = entries.filter(e => {
                if (typeof(e) != 'string' && e.type) {
                    if (!e.class || !e.class.includes('entry-meta-stream')) {
                        if (!['group', 'stream'].includes(e.type)) {
                            return true;
                        }
                    }
                }
                return !this.allow(e);
            });
        }
        return entries;
    }
}
export default ParentalControl;
