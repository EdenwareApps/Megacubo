import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import cloud from "../cloud/cloud.js";
import crypto from 'crypto'
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import { getDomain } from "../utils/utils.js";                                     
import contentProfile from "../profiles/content-profile.js";

const PIN_LENGTH = 4;
const PIN_MAX_ATTEMPTS = 3;
                                        
class ParentalControl extends EventEmitter {
    constructor() {
        super();
        this.authTTL = 1800; // 30 minutes (increased from 10 minutes to reduce PIN prompts)
        this.termsRegex = false;
        this.customTermsRegex = false;
        this.defaultTerms = []; // Terms from cloud (always active)
        this.customTerms = []; // Custom terms from user
        this.terms = []; // Combined terms (default + custom)
        this.setupTermsPromise = null; // Track ongoing setup
        this.authPromise = null; // Track ongoing authentication to prevent multiple simultaneous prompts
        this.on('updated', () => {
            // Only refresh menu if it's available and has the method (not in workers)
            if (menu && typeof menu.refreshNow === 'function') {
                process.nextTick(() => menu.refreshNow())
            }
        })
        config.on('change', (keys, data) => {
            if(keys.includes('parental-control-custom-terms')) {
                this.setupTerms().catch(err => console.error('Error updating custom terms:', err));
            }
        });
        // Initialize terms asynchronously
        this.setupTerms().catch(err => console.error('Error setting up parental control terms:', err));

        // Watch for cloud configure updates — substitui o polling manual do update()
        this._unsubConfigure = cloud.sync('configure', c => {
            if (c && c.adultTerms) {
                const newDefaultTerms = typeof c.adultTerms === 'string'
                    ? this.keywords(c.adultTerms)
                    : (Array.isArray(c.adultTerms) ? c.adultTerms.map(t => String(t).toLowerCase().trim()).filter(t => t.length >= 2) : []);

                const termsChanged = JSON.stringify([...newDefaultTerms].sort()) !== JSON.stringify([...this.defaultTerms].sort());
                if (termsChanged) {
                    this.defaultTerms = newDefaultTerms;
                    this.setupTerms().catch(err => console.error('Error rebuilding terms regex:', err));
                }
            }
        });
    }
    /**
     * Maximum allowed age rating; 18 means +18 content is released.
     * The age alone decides this - the content profile never relaxes it.
     */
    maxAge() {
        return contentProfile.maxAge();
    }
    adultAllowed() {
        return contentProfile.adultAllowed();
    }
    hasPin() {
        return !!config.get('parental-control-pin');
    }
    hasLegacyPassword() {
        return !!config.get('parental-control-pw');
    }
    installerAdultExemption() {
        return contentProfile.isInstallerAdult();
    }
    /**
     * Selectable age ratings. Only 18 releases +18 content.
     */
    ageValues() {
        return [0, 7, 12, 13, 16, 18];
    }
    ageIcon(age) {
        return {
            0: 'fas fa-check-circle',
            7: 'fas fa-child',
            12: 'fas fa-user',
            13: 'fas fa-user-friends',
            16: 'fas fa-user-tie',
            18: 'fas fa-user-secret'
        }[age] || 'fas fa-user';
    }
    ageLabel(age) {
        return lang['AGE_RATING_' + age + '_PLUS'] || (age ? age + '+' : '0+');
    }
    /**
     * Persist the age rating. The content profile is never changed here: an
     * adult profile stays remembered and is suspended while age < 18.
     */
    setAge(age) {
        contentProfile.setMaxAge(age);
        this.emit('updated');
        osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal');
    }
    /**
     * PIN gate used by shortcuts and dialogs.
     * Returns false when the user cannot be authorized.
     */
    async confirmAuth() {
        if (this.installerAdultExemption()) {
            return true;
        }
        if (!this.hasPin() && !this.hasLegacyPassword()) {
            const res = await menu.dialog([
                { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt' },
                { template: 'message', text: lang.PIN_REQUIRED || 'Crie um PIN de 4 números para proteger o controle dos pais.' },
                { template: 'option', id: 'setup', fa: 'fas fa-key', text: lang.PIN || 'PIN' }
            ], 'parental-control-setup', true);
            if (res != 'setup') {
                return false;
            }
            return await this.setupPin().catch(err => {
                console.error('Error setting up PIN:', err);
                return false;
            });
        }
        if (this.lazyAuth()) {
            return true;
        }
        try {
            await this.auth();
            return true;
        } catch (err) {
            return false;
        }
    }
    /**
     * Age rating dialog, used by the keyboard shortcut.
     * Returns the chosen age or false when cancelled/unauthorized.
     */
    async promptAge() {
        if (!await this.confirmAuth()) {
            return false;
        }
        const currentAge = this.maxAge();
        const lines = [
            { template: 'question', text: lang.AGE_RATING_MAXIMUM, fa: 'fas fa-calendar-alt' },
            { template: 'message', text: lang.AGE_RATING_DESCRIPTION }
        ];
        if (contentProfile.isSuspended()) {
            lines.push({
                template: 'message',
                text: lang.CONTENT_PROFILE_SUSPENDED_DESCRIPTION || 'O perfil Adulto está suspenso enquanto a idade máxima for menor que 18 anos. Ao voltar para 18+, ele é reativado automaticamente.'
            });
        }
        const options = this.ageValues().map(age => ({
            template: 'option',
            id: 'age-' + age,
            fa: age === currentAge ? 'fas fa-check-circle' : this.ageIcon(age),
            text: this.ageLabel(age) + (age === currentAge ? ' ✓' : '')
        }));
        const optionId = await menu.dialog(lines.concat(options), 'parental-control-age', true);
        if (!optionId) {
            return false;
        }
        const age = parseInt(String(optionId).replace('age-', ''), 10);
        if (isNaN(age)) {
            return false;
        }
        this.setAge(age);
        return age;
    }
    buildRegex(terms) {
        if (!terms.length) {
            return false;
        }
        // Escape all regex metacharacters (except ^ and $, handled below) so terms match literally
        const escapeRegExp = (text) => text.replace(/[.*+?{}()|[\]\\]/g, '\\$&')
        const rgx = terms
            .map(escapeRegExp)
            .join('|')
            .replace(/[\^\$]/g, '(\\b|\\W)') // Keep ^ and $ as word-boundary markers
        try {
            return new RegExp(rgx, 'i')
        } catch (err) {
            console.error('Parental control terms invalid regex: '+ rgx, err);
            return false;
        }
    }
    entry() {
        return {
            name: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt', type: 'group',
            renderer: async () => {
                if (this.installerAdultExemption()) {
                    // The adult installer profile stays trusted until the user changes it.
                } else if (!this.hasPin() && !this.hasLegacyPassword()) {
                    await menu.dialog([
                        { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt' },
                        { template: 'message', text: lang.PIN_REQUIRED || 'Crie um PIN de 4 números para proteger o controle dos pais.' },
                        { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
                    ], 'parental-control-setup', true);
                    let setup = false;
                    let attempts = 0;
                    const maxAttempts = 5;
                    
                    while (!setup && attempts < maxAttempts) {
                        attempts++;
                        setup = await this.setupPin().catch(err => {
                            console.error('Error setting up PIN:', err);
                            return false;
                        });
                        
                        if (!setup) {
                            if (attempts < maxAttempts) {
                                const retry = await menu.dialog([
                                    { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt' },
                                    { template: 'message', text: lang.PIN_SETUP_FAILED || 'A configuração do PIN não foi concluída. Deseja tentar novamente?' },
                                    { template: 'option', id: 'yes', fa: 'fas fa-redo', text: lang.YES || 'Yes' },
                                    { template: 'option', id: 'no', fa: 'fas fa-times', text: lang.NO || 'No' }
                                ], 'parental-control-retry', true);
                                
                                if (retry !== 'yes') {
                                    menu.displayErr(lang.PIN_REQUIRED || 'Um PIN é obrigatório para acessar o controle dos pais');
                                    return [];
                                }
                            } else {
                                menu.displayErr(lang.PIN_SETUP_MAX_ATTEMPTS || 'Muitas tentativas. Por favor, tente novamente mais tarde.');
                                return [];
                            }
                        }
                    }
                    
                    if (!setup) {
                        menu.displayErr(lang.PIN_REQUIRED || 'Um PIN é obrigatório para acessar o controle dos pais');
                        return [];
                    }
                } else {
                    try {
                        await this.auth();
                    } catch (err) {
                        return [];
                    }
                }
                
                let opts = [
                    // Age rating control (default: 16+)
                    {
                        name: lang.AGE_RATING_MAXIMUM,
                        details: lang.AGE_RATING_DESCRIPTION,
                        type: 'select',
                        fa: 'fas fa-calendar-alt',
                        safe: true,
                        renderer: async () => {
                            // Only authenticate if not already authorized
                            if (!this.lazyAuth()) {
                                await this.auth();
                            }
                            const currentAge = this.maxAge();
                            const options = this.ageValues().map(value => ({
                                name: this.ageLabel(value),
                                fa: this.ageIcon(value),
                                value,
                                selected: currentAge === value,
                                type: 'action',
                                action: async () => {
                                    // Only authenticate if not already authorized
                                    if (!this.lazyAuth()) {
                                        await this.auth();
                                    }
                                    this.setAge(value);
                                }
                            }));
                            return options;
                        }
                    },
                    
                    // Custom keywords (additional to default terms from cloud)
                    {
                        name: lang.FILTER_WORDS,
                        details: lang.SEPARATE_WITH_COMMAS + ' ' + lang.FILTER_WORDS_CUSTOM_DESCRIPTION,
                        type: 'input',
                        fa: 'fas fa-shield-alt',
                        action: async (e, v) => {
                            // Only authenticate if not already authorized and value is being set
                            if (v !== false) {
                                if (!this.lazyAuth()) {
                                    await this.auth();
                                }
                                config.set('parental-control-custom-terms', v || '');
                                await this.setupTerms().catch(err => console.error('Error updating custom terms:', err));
                            }
                        },
                        value: () => {
                            return config.get('parental-control-custom-terms', '');
                        },
                        placeholder: lang.FILTER_WORDS,
                        multiline: true,
                        safe: true
                    },
                    
                    // Change PIN option
                    {
                        name: lang.CHANGE_PIN || lang.CHANGE_PASSWORD || 'Change PIN',
                        details: lang.CHANGE_PIN_DESCRIPTION || lang.CHANGE_PASSWORD_DESCRIPTION || 'Change parental control PIN',
                        type: 'action',
                        fa: 'fas fa-key',
                        safe: true,
                        action: async () => {
                            // Only authenticate if not already authorized
                            if (!this.lazyAuth()) {
                                await this.auth();
                            }
                            const setup = await this.setupPin().catch(err => console.error(err));
                            if (setup) {
                                osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal');
                            }
                        }
                    }
                ];
                return opts;
            }
        };
    }
    /**
     * Get default terms from cloud configuration
     * These terms are always active and cannot be edited by user
     * Agora mantidos atualizados via cloud.sync() no constructor
     */
    getDefaultTerms() {
        return this.defaultTerms;
    }
    
    /**
     * Setup terms regex combining default terms (from cloud) and custom terms (from user)
     */
    async setupTerms() {
        // Prevent concurrent calls
        if (this.setupTermsPromise) {
            return this.setupTermsPromise;
        }
        
        this.setupTermsPromise = (async () => {
            try {
                // Get default terms from cloud
                this.defaultTerms = await this.getDefaultTerms();
                
                // Get custom terms from config
                const customTermsStr = config.get('parental-control-custom-terms', '');
                this.customTerms = this.keywords(customTermsStr);
                
                // Combine both (default terms are always active, custom terms are additional)
                this.terms = [...new Set([...this.defaultTerms, ...this.customTerms])];
                
                this.termsRegex = this.buildRegex(this.terms);
                this.customTermsRegex = this.buildRegex(this.customTerms);
                
                this.emit('updated');
            } finally {
                this.setupTermsPromise = null;
            }
        })();
        
        return this.setupTermsPromise;
    }
    
    // update() removido — substituído por cloud.sync('configure', ...) no constructor
    keywords(str) {
        return str.toLowerCase().split(',').filter(t => {
            return t.length >= 2;
        });
    }
    has(stack) {
        return this.termsRegex ? stack.match(this.termsRegex) : false;
    }
    /**
     * Whether the given text is blocked by parental control terms.
     * When +18 content is released only the user's custom terms apply, as the
     * default (cloud) terms are adult-content terms.
     */
    blockedByTerms(stack) {
        if (!stack || typeof(stack) != 'string') {
            return false
        }
        if (this.adultAllowed()) {
            return this.customTermsRegex ? !!stack.match(this.customTermsRegex) : false
        }
        return !!this.has(stack)
    }
    allow(entry) {
        if (typeof(entry) == 'string') {
            return !this.blockedByTerms(entry)
        }
        
        const adultAllowed = this.adultAllowed()
        
        // Check for adult domains in URL FIRST (before type check)
        // This applies to all types including VOD, and handles both entry.url and entry.entry.url
        const urlToCheck = entry.url || entry.entry?.url;
        if (urlToCheck && !adultAllowed) {
            const domain = getDomain(urlToCheck);
            const adultDomains = ['adultiptv.net', 'redtraffic.xyz'];
            // Check if domain ends with any adult domain
            const isAdultDomain = adultDomains.some(adultDomain => 
                domain === adultDomain || domain.endsWith('.' + adultDomain)
            );
            if (isAdultDomain) {
                return false;
            }
        }
        
        if (entry.type && !['group', 'stream'].includes(entry.type)) {
            return true;
        }
        
        // Enhanced parental control with age rating support
        let str, allow = true;
        str = entry.name || entry.title || entry.entry?.name;
        if (entry.group || entry.entry?.group) {
            str += ' ' + (entry.group || entry.entry?.group);
        }
        
        // Check age rating first (highest priority)
        // Check both entry.age and entry.programme.age for EPG data
        const age = entry.age !== undefined ? entry.age : (entry.programme?.age || 0)
        if (age > 0) {
            if (age > this.maxAge()) {
                allow = false;
            }
        }
        
        // Check parental control flags from EPG programme data
        if (entry.programme) {
            // Check explicit parental control flags (unified field)
            if (entry.programme.parental === 'yes' || entry.programme.parental === 'true') {
                allow = false;
            }
            
            // Check rating system (BR, MPAA, TVPG, etc.)
            if (entry.programme.rating) {
                const rating = entry.programme.rating.toLowerCase();
                // Adult ratings
                if (rating.includes('18') || rating.includes('adult') || rating.includes('r-rated') || 
                    rating.includes('nc-17') || rating.includes('xxx')) {
                    if (!adultAllowed) {
                        allow = false;
                    }
                }
                // Teen ratings above parental control age
                else if (rating.includes('16') || rating.includes('pg-16') || rating.includes('tv-ma')) {
                    if (this.maxAge() < 16) {
                        allow = false;
                    }
                }
                // 13+ ratings
                else if (rating.includes('13') || rating.includes('pg-13') || rating.includes('tv-14')) {
                    if (this.maxAge() < 13) {
                        allow = false;
                    }
                }
                // 12+ ratings
                else if (rating.includes('12') || rating.includes('pg-12')) {
                    if (this.maxAge() < 12) {
                        allow = false;
                    }
                }
            }
        }
        
        // Check traditional terms-based blocking
        if (str && this.blockedByTerms(str)) {
            allow = false;
        }
        
        return allow;
    }
    /**
     * Filter entries - always uses block behavior (requires PIN to unlock)
     * Content is blocked if it exceeds age rating or matches blocked keywords
     */
    filter(entries, skipProtect) {
        if (entries.length) {
            // Always use block behavior: protect entries that should be blocked
            if (!skipProtect) {
                entries = entries.map(e => this.allow(e) ? e : this.protect(e));
            } else {
                // If skipProtect, just filter out blocked entries
                entries = entries.filter(this.allow.bind(this));
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
    /**
     * Check if authentication is required (lazy check)
     * SECURITY: Returns true ONLY if already authenticated
     * If no PIN is set, returns false (parental control is active but not authenticated)
     */
    lazyAuth() {
        if (this.installerAdultExemption()) {
            return true;
        }
        if (this.authenticated) {
            if (typeof this.authenticated == 'number' && (Date.now() / 1000) <= this.authenticated) {
                return true;
            }
            delete this.authenticated;
        }
        return false;
    }
    /**
     * Authenticate user - required to access parental control settings or unlock blocked content
     * SECURITY: Never allows access without authorization - missing credentials throw an error
     */
    async auth() {
        if (this.installerAdultExemption()) {
            return true;
        }
        const now = (Date.now() / 1000);
        const pin = config.get('parental-control-pin');
        const legacyPassword = config.get('parental-control-pw');
        
        if (!pin && !legacyPassword) {
            menu.displayErr(lang.PIN_REQUIRED || 'Um PIN é obrigatório');
            throw new Error('PIN not set');
        }
        
        // Check if already authenticated and not expired
        if (this.authenticated && typeof this.authenticated === 'number' && now <= this.authenticated) {
            return true;
        }
        
        // If authentication is already in progress, wait for it to complete
        if (this.authPromise) {
            return this.authPromise;
        }
        
        // Start new authentication process
        this.authPromise = (async () => {
            try {
                // Double-check authentication status (might have been set by another concurrent call)
                if (this.authenticated && typeof this.authenticated === 'number' && now <= this.authenticated) {
                    return true;
                }
                
                if (pin) {
                    let mismatch = false;
                    for (let attempt = 1; attempt <= PIN_MAX_ATTEMPTS; attempt++) {
                        const credential = await menu.pin({
                            question: lang.ENTER_PIN || 'Digite seu PIN de 4 números',
                            message: mismatch ? (lang.PIN_INCORRECT || 'PIN incorreto. Tente novamente.') : '',
                            fa: 'fas fa-key',
                            length: PIN_LENGTH
                        });
                        if (!credential) {
                            throw new Error('PIN prompt cancelled');
                        }
                        if (this.verifyPin(credential, pin)) {
                            this.authenticated = now + this.authTTL;
                            return true;
                        }
                        mismatch = true;
                    }
                    menu.displayErr(lang.PIN_INCORRECT || 'PIN incorreto');
                    throw new Error('PIN mismatch');
                }
                
                const credential = await menu.prompt({
                    question: lang.LEGACY_PASSWORD || lang.PASSWORD || 'Senha atual',
                    fa: 'fas fa-key',
                    isPassword: true
                });
                
                if (!credential) {
                    throw new Error('PIN prompt cancelled');
                }
                
                if (legacyPassword && this.md5(credential) == legacyPassword) {
                    if (await this.setupPin()) {
                        this.authenticated = (Date.now() / 1000) + this.authTTL;
                        return true;
                    }
                    throw new Error('PIN migration cancelled');
                }
                menu.displayErr(lang.PASSWORD_NOT_MATCH);
                throw new Error('PIN mismatch');
            } finally {
                // Clear the promise so next call can start fresh
                this.authPromise = null;
            }
        })();
        
        return this.authPromise;
    }
    verifyPin(pin, stored) {
        if (typeof pin != 'string' || !/^\d{4}$/.test(pin) ||
            !stored || typeof stored != 'object' ||
            typeof stored.salt != 'string' || !/^[0-9a-f]{32}$/i.test(stored.salt) ||
            typeof stored.hash != 'string' || !/^[0-9a-f]{64}$/i.test(stored.hash)) {
            return false;
        }
        const expected = Buffer.from(stored.hash, 'hex');
        const actual = crypto.scryptSync(pin, Buffer.from(stored.salt, 'hex'), 32);
        return expected.length == actual.length && crypto.timingSafeEqual(expected, actual);
    }
    async setupPin() {
        // Clear any previous authentication
        if (this.authenticated) {
            delete this.authenticated;
        }
        const pin = await menu.pin({
            question: lang.CREATE_YOUR_PIN || 'Crie um PIN de 4 números',
            message: lang.CREATE_PIN_HINT || 'Digite os 4 números e o PIN será confirmado automaticamente.',
            length: PIN_LENGTH
        });
        
        if (!pin) {
            return false;
        }
        
        if (!/^\d{4}$/.test(pin)) {
            await menu.dialog([
                { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-exclamation-triangle' },
                { template: 'message', text: lang.PIN_INVALID || 'O PIN deve conter exatamente 4 números.' },
                { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
            ], 'parental-control', true);
            return false;
        }
        
        const pin2 = await menu.pin({
            question: lang.TYPE_PIN_AGAIN || 'Digite o PIN novamente para confirmar',
            length: PIN_LENGTH
        });
        
        if (!pin2) {
            return false;
        }
        
        if (pin === pin2) {
            const salt = crypto.randomBytes(16);
            config.set('parental-control-pin', {
                salt: salt.toString('hex'),
                hash: crypto.scryptSync(pin, salt, 32).toString('hex')
            });
            config.set('parental-control-pw', '');
            this.authenticated = (Date.now() / 1000) + this.authTTL;
            osd.show(lang.PIN_CREATED || 'PIN criado com sucesso!', 'fas fa-check-circle faclr-green', 'options', 'normal');
            return true;
        } else {
            await menu.dialog([
                { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-exclamation-triangle' },
                { template: 'message', text: lang.PIN_NOT_MATCH || 'Os PINs não coincidem. Tente novamente.' },
                { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
            ], 'parental-control', true);
            return false;
        }
    }
    async setupAuth() {
        return this.setupPin();
    }
    protect(e) {
        if (e.class && e.class.includes('parental-control-protected')) {
            return e;
        }
        const action = async () => {
            if (!this.hasPin() && !this.hasLegacyPassword() && !this.installerAdultExemption()) {
                await menu.dialog([
                    { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt' },
                    { template: 'message', text: lang.PIN_REQUIRED || 'Crie um PIN de 4 números para proteger o controle dos pais.' },
                    { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
                ], 'parental-control-setup', true);
                
                const setup = await this.setupPin().catch(err => {
                    console.error('Error setting up PIN:', err);
                    return false;
                });
                if (!setup) {
                    return;
                }
            }
            
            try {
                let allow = await this.auth();
                if (allow === true) {
                    if (typeof e.action === 'function') {
                        const ret = e.action(e)
                        if (ret && typeof ret.catch === 'function') ret.catch(err => console.error(err))
                    } else {
                        menu.emit('action', e)
                    }
                }
            } catch (err) {
                if (err && err.message !== 'PIN prompt cancelled' && err.message !== 'PIN migration cancelled') {
                    console.warn('Parental control authorization failed:', err.message || err);
                }
            }
        };
        const entry = Object.assign(Object.assign({}, e), { 
            action, 
            class: 'parental-control-protected allow-stream-state', 
            type: 'action', 
            icon: undefined, 
            fa: 'fas fa-lock',
            details: lang.CONTENT_BLOCKED || 'Conteúdo bloqueado - digite o PIN para desbloquear'
        });
        return entry;
    }
    /**
     * Legacy method - "only adult content" mode removed
     * Always returns empty array as this feature is no longer supported
     * @deprecated This method is kept for compatibility but always returns empty
     */
    only(entries) {
        // Adult-only mode removed - always return empty
        return [];
    }
}
export default ParentalControl;
