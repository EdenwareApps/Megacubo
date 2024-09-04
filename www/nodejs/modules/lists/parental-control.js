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
            keys.includes('parental-control-terms') && this.setTerms();
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
                                                fine = await this.setupAuth().catch(console.error);
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
                }
                return opts;
            }
        };
    }
    setupTerms(tms) {
        this.terms = this.keywords(tms || config.get('parental-control-terms'));
        if (this.terms.length) {
            const rgx = this.terms.join('|').replace(new RegExp('\\+'), '\\+').replace(new RegExp('[\\^\\$]'), '(\\b|\\W)')
            try {
                this.termsRegex = new RegExp(rgx, 'i')
            } catch (e) {
                console.error(e);
                console.error('Parental control terms invalid regex: '+ rgx)
            }
        } else {
            this.termsRegex = false;
        }
    }
    setTerms(terms) {
        if (typeof (terms) == 'string') {
            this.terms = this.keywords(terms);
        } else if (!Array.isArray(terms)) {
            console.error('Bad terms format', terms);
            return;
        }
        this.terms = this.terms.unique(); // make unique
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
        if (typeof (entry) == 'string') {
            return !this.has(entry);
        }
        if (entry.type && !['group', 'stream'].includes(entry.type)) {
            return true;
        }
        let str, allow = true;
        str = entry.name;
        if (entry.group) {
            str += ' ' + entry.group;
        }
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
        if (e.class && e.class.indexOf('parental-control-protected') != -1) {
            return e;
        }
        const action = async () => {
            let allow = await this.auth().catch(console.error);
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
                if (typeof (e) != 'string' && e.type) {
                    if (!e.class || e.class.indexOf('entry-meta-stream') == -1) {
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
