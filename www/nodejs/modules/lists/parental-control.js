import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import cloud from "../cloud/cloud.js";
import crypto from 'crypto'
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import { getDomain } from "../utils/utils.js";                                     
                                        
class ParentalControl extends EventEmitter {
    constructor() {
        super();
        this.authTTL = 1800; // 30 minutes (increased from 10 minutes to reduce password prompts)
        this.termsRegex = false;
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
        renderer.ready && renderer.ready(() => this.update());
    }
    entry() {
        return {
            name: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt', type: 'group',
            renderer: async () => {
                // SECURITY: Force password creation if not set - cannot proceed without it
                const password = config.get('parental-control-pw');
                if (!password) {
                    // Show clear message for parents
                    await menu.dialog([
                        { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt' },
                        { template: 'message', text: lang.PARENTAL_CONTROL_SETUP_REQUIRED || 'A senha é obrigatória para proteger o controle dos pais. Por favor, crie uma senha agora.' },
                        { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
                    ], 'parental-control-setup', true);
                    
                    // Force password creation - allow retry if user cancels or makes mistake
                    let setup = false;
                    let attempts = 0;
                    const maxAttempts = 5; // Prevent infinite loop
                    
                    while (!setup && attempts < maxAttempts) {
                        attempts++;
                        setup = await this.setupAuth().catch(err => {
                            console.error('Error setting up password:', err);
                            return false;
                        });
                        
                        if (!setup) {
                            // User cancelled or made mistake - ask if they want to try again
                            if (attempts < maxAttempts) {
                                const retry = await menu.dialog([
                                    { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt' },
                                    { template: 'message', text: lang.PASSWORD_SETUP_FAILED || 'Password setup was not completed. Do you want to try again?' },
                                    { template: 'option', id: 'yes', fa: 'fas fa-redo', text: lang.YES || 'Yes' },
                                    { template: 'option', id: 'no', fa: 'fas fa-times', text: lang.NO || 'No' }
                                ], 'parental-control-retry', true);
                                
                                if (retry !== 'yes') {
                                    // User chose not to retry
                                    menu.displayErr(lang.PASSWORD_REQUIRED || 'A senha é obrigatória para acessar o controle dos pais');
                                    return [];
                                }
                            } else {
                                // Max attempts reached
                                menu.displayErr(lang.PASSWORD_SETUP_MAX_ATTEMPTS || 'Muitas tentativas. Por favor, tente novamente mais tarde.');
                                return [];
                            }
                        }
                    }
                    
                    if (!setup) {
                        // Password setup failed after all attempts
                        menu.displayErr(lang.PASSWORD_REQUIRED || 'A senha é obrigatória para acessar o controle dos pais');
                        return [];
                    }
                } else {
                    // Password exists, require authentication
                    try {
                        await this.auth();
                    } catch (err) {
                        // Authentication failed - deny access
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
                            // Only ask for password if not already authenticated
                            if (!this.lazyAuth()) {
                                await this.auth();
                            }
                            const currentAge = config.get('parental-control-age', 16); // Default to 16+
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
                                    // Only ask for password if not already authenticated
                                    if (!this.lazyAuth()) {
                                        await this.auth();
                                    }
                                    config.set('parental-control-age', opt.value);
                                    this.emit('updated');
                                    osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal');
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
                            // Only ask for password if not already authenticated and value is being set
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
                    
                    // Change password option
                    {
                        name: lang.CHANGE_PASSWORD || 'Change Password',
                        details: lang.CHANGE_PASSWORD_DESCRIPTION || 'Change parental control password',
                        type: 'action',
                        fa: 'fas fa-key',
                        safe: true,
                        action: async () => {
                            // Only ask for password if not already authenticated
                            if (!this.lazyAuth()) {
                                await this.auth();
                            }
                            const setup = await this.setupAuth().catch(err => console.error(err));
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
     */
    async getDefaultTerms() {
        try {
            const cloudConfig = await cloud.get('configure').catch(err => {
                console.error('Failed to get cloud config:', err);
                return null;
            });
            if (cloudConfig && cloudConfig.adultTerms) {
                if (typeof cloudConfig.adultTerms === 'string') {
                    return this.keywords(cloudConfig.adultTerms);
                } else if (Array.isArray(cloudConfig.adultTerms)) {
                    return cloudConfig.adultTerms.map(t => String(t).toLowerCase().trim()).filter(t => t.length >= 2);
                }
            }
        } catch (err) {
            console.error('Error loading default terms from cloud:', err);
        }
        return [];
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
                        this.termsRegex = false;
                    }
                } else {
                    this.termsRegex = false;
                }
                
                this.emit('updated');
            } finally {
                this.setupTermsPromise = null;
            }
        })();
        
        return this.setupTermsPromise;
    }
    
    /**
     * Update default terms from cloud (called periodically)
     */
    update() {
        // Always update default terms from cloud (they're not stored in config)
        cloud.get('configure').then(c => {
            if (c && c.adultTerms) {
                const newDefaultTerms = typeof c.adultTerms === 'string' 
                    ? this.keywords(c.adultTerms)
                    : (Array.isArray(c.adultTerms) ? c.adultTerms.map(t => String(t).toLowerCase().trim()).filter(t => t.length >= 2) : []);
                
                // Only update if terms changed
                const termsChanged = JSON.stringify(newDefaultTerms.sort()) !== JSON.stringify(this.defaultTerms.sort());
                if (termsChanged) {
                    this.defaultTerms = newDefaultTerms;
                    this.setupTerms().catch(err => console.error('Error rebuilding terms regex:', err)); // Rebuild regex with new default terms
                }
            }
        }).catch(err => {
            console.error('Error updating default terms from cloud:', err);
            setTimeout(() => this.update(), 10000);
        });
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
        
        // Check for adult domains in URL FIRST (before type check)
        // This applies to all types including VOD, and handles both entry.url and entry.entry.url
        const urlToCheck = entry.url || entry.entry?.url;
        if (urlToCheck) {
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
            const parentalControlAge = config.get('parental-control-age', 16); // Default to 16+
            if (age > parentalControlAge) {
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
                    allow = false;
                }
                // Teen ratings above parental control age
                else if (rating.includes('16') || rating.includes('pg-16') || rating.includes('tv-ma')) {
                    const parentalControlAge = config.get('parental-control-age', 16); // Default to 16+
                    if (parentalControlAge < 16) {
                        allow = false;
                    }
                }
                // 13+ ratings
                else if (rating.includes('13') || rating.includes('pg-13') || rating.includes('tv-14')) {
                    const parentalControlAge = config.get('parental-control-age', 16); // Default to 16+
                    if (parentalControlAge < 13) {
                        allow = false;
                    }
                }
                // 12+ ratings
                else if (rating.includes('12') || rating.includes('pg-12')) {
                    const parentalControlAge = config.get('parental-control-age', 16); // Default to 16+
                    if (parentalControlAge < 12) {
                        allow = false;
                    }
                }
            }
        }
        
        // Check traditional terms-based blocking
        if (str && this.has(str)) {
            allow = false;
        }
        
        return allow;
    }
    /**
     * Filter entries - always uses block behavior (requires password to unlock)
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
     * If no password is set, returns false (parental control is active but not authenticated)
     */
    lazyAuth() {
        if (this.authenticated) {
            return true;
        }
        // SECURITY: If no password is set, parental control is still active (blocks content)
        // but user is not authenticated (cannot access adult content grid)
        return false;
    }
    /**
     * Authenticate user - required to access parental control settings or unlock blocked content
     * SECURITY: Never allows access without password - if no password exists, throws error
     */
    async auth() {
        const now = (Date.now() / 1000);
        const password = config.get('parental-control-pw');
        
        // SECURITY: If no password is set, throw error - password must be created first
        if (!password) {
            menu.displayErr(lang.PASSWORD_REQUIRED || 'A senha é obrigatória');
            throw new Error('Password not set');
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
                
                // Require password
                const pass = await menu.prompt({
                    question: lang.PASSWORD,
                    fa: 'fas fa-key',
                    isPassword: true
                });
                
                // User cancelled the prompt
                if (!pass || pass === null || pass === undefined) {
                    throw new Error('Password prompt cancelled');
                }
                
                // Verify password
                if (this.md5(pass) == password) {
                    this.authenticated = now + this.authTTL;
                    return true;
                } else {
                    menu.displayErr(lang.PASSWORD_NOT_MATCH);
                    throw new Error('Password mismatch');
                }
            } finally {
                // Clear the promise so next call can start fresh
                this.authPromise = null;
            }
        })();
        
        return this.authPromise;
    }
    async setupAuth() {
        // Clear any previous authentication
        if (this.authenticated) {
            delete this.authenticated;
        }
        // Clear any ongoing authentication
        if (this.authPromise) {
            this.authPromise = null;
        }
        
        // First password - allow cancel (will be handled by caller)
        const pass = await menu.prompt({
            question: lang.CREATE_YOUR_PASS || 'Crie uma senha para o controle dos pais',
            fa: 'fas fa-key',
            isPassword: true,
            placeholder: lang.PASSWORD || 'Senha'
        });
        
        // User cancelled first prompt
        if (!pass) {
            return false;
        }
        
        // Validate password length
        if (pass.length < 4) {
            await menu.dialog([
                { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-exclamation-triangle' },
                { template: 'message', text: lang.PASSWORD_TOO_SHORT || 'A senha deve ter pelo menos 4 caracteres' },
                { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
            ], 'parental-control', true);
            return false;
        }
        
        // Confirm password - allow cancel (will be handled by caller)
        const pass2 = await menu.prompt({
            question: lang.TYPE_PASSWORD_AGAIN || 'Digite a senha novamente para confirmar',
            fa: 'fas fa-key',
            isPassword: true,
            placeholder: lang.PASSWORD || 'Senha'
        });
        
        // User cancelled confirmation prompt
        if (!pass2) {
            return false;
        }
        
        // Check if passwords match
        if (pass === pass2) {
            config.set('parental-control-pw', this.md5(pass));
            // Show success message
            osd.show(lang.PASSWORD_CREATED || 'Senha criada com sucesso!', 'fas fa-check-circle faclr-green', 'options', 'normal');
            return true;
        } else {
            // Passwords don't match - show clear error
            await menu.dialog([
                { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-exclamation-triangle' },
                { template: 'message', text: lang.PASSWORD_NOT_MATCH || 'As senhas não coincidem. Por favor, tente novamente.' },
                { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
            ], 'parental-control', true);
            return false;
        }
    }
    protect(e) {
        if (e.class && e.class.includes('parental-control-protected')) {
            return e;
        }
        const action = async () => {
            // SECURITY: Always require password to unlock blocked content
            const password = config.get('parental-control-pw');
            if (!password) {
                // No password set - force creation before allowing access
                await menu.dialog([
                    { template: 'question', text: lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt' },
                    { template: 'message', text: lang.PARENTAL_CONTROL_SETUP_REQUIRED || 'A senha é obrigatória para proteger o controle dos pais. Por favor, crie uma senha agora.' },
                    { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
                ], 'parental-control-setup', true);
                
                const setup = await this.setupAuth().catch(err => {
                    console.error('Error setting up password:', err);
                    return false;
                });
                if (!setup) {
                    // Password setup failed - content remains blocked
                    return;
                }
            }
            
            // Password exists, require authentication
            try {
                let allow = await this.auth();
                if (allow === true) {
                    // Authentication successful - unlock and play content
                    menu.emit('action', e);
                }
            } catch (err) {
                // Authentication failed or cancelled - content remains blocked
                // Only show error if it's not a cancellation
                if (err && err.message !== 'Password prompt cancelled') {
                    // Error message already shown by auth() for password mismatch
                }
            }
        };
        const entry = Object.assign(Object.assign({}, e), { 
            action, 
            class: 'parental-control-protected allow-stream-state', 
            type: 'action', 
            icon: undefined, 
            fa: 'fas fa-lock',
            details: lang.CONTENT_BLOCKED || 'Conteúdo bloqueado - digite a senha para desbloquear'
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
