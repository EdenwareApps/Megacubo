import { EventEmitter } from 'node:events';
import countries from '@edenware/countries';
import fs from "fs";
import path from "path";
import config from "../config/config.js"
import { parse } from '../serialize/serialize.js'
import ready from '../ready/ready.js'
import { moment } from '../utils/utils.js'

class Language extends EventEmitter {
    constructor() {
        super()
        this.countries = countries
        this.ready = ready()
    }
    async findLanguages() {
        if (!this.folder) {
            console.error('❌ Language folder is undefined in findLanguages()')
            this.availableLocales = []
            this.hints = { langs: [], countries: [] }
            this.userAvailableLocales = []
            return []
        }
        
        let files = await fs.promises.readdir(this.folder).catch(e => {
            if (typeof menu !== 'undefined') {
                menu.displayErr(e)
            } else {
                console.error(e)
            }
        });
        
        if (!Array.isArray(files)) {
            console.error('❌ Failed to read language folder:', this.folder)
            this.availableLocales = []
            this.hints = { langs: [], countries: [] }
            this.userAvailableLocales = []
            return []
        }
        
        this.availableLocales = files.filter(f => f.substr(-5).toLowerCase() == '.json').map(f => f.split('.').shift());
        this.hints = this.parseLanguageHint(this.languageHints || this.languageHint);
        this.userAvailableLocales = this.hints.langs.filter(l => this.availableLocales.includes(l));
        return this.hints.langs;
    }
    async findCountryCode(force) {
        if (!this.timezone || typeof this.timezone.minutes !== 'number') {
            try {
                const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
                const minutesOffset = -new Date().getTimezoneOffset()
                console.warn('⚠️ Timezone missing, auto-detected:', tzName, minutesOffset)
                this.timezone = {
                    name: tzName,
                    minutes: minutesOffset,
                    offset: minutesOffset / 60
                }
            } catch (error) {
                console.error('❌ Failed to auto-detect timezone:', error.message)
                this.countryCode = config.get('country') || 'us'
                this.alternateCountries = []
                return this.countryCode
            }
        }
        
        if (!this.hints || !Array.isArray(this.hints.countries)) {
            console.error('❌ Hints or countries array is undefined')
            this.countryCode = 'us'
            this.alternateCountries = []
            return this.countryCode
        }
        
        const countriesTz = this.countries.getCountriesFromTZ(this.timezone.minutes);
        const ranked = this.rankCountryCandidates(this.hints, countriesTz);
        if (force !== true) {
            const country = config.get('country');
            if (country) {
                this.isTrusted = true;
                this.alternateCountries = ranked.map(c => c.code).filter(c => c != country).slice(0, 8);
                this.countryCode = country;
                return this.countryCode;
            }
        }
        this.alternateCountries = ranked.slice(1).map(c => c.code).slice(0, 8); // keep the country picker short
        // Trust the detection when the country comes from the OS region setting (the user did
        // choose it, even if running the system in another language), when the best candidate is
        // the only one, or when it is the region of the top system language matching the timezone.
        // Otherwise the wizard/options will offer the alternatives to the user.
        const top = ranked[0]
        const primaryRegion = this.hints.countries && this.hints.countries[0]
        const regionMatches = !!top && !!this.systemRegion && top.code === this.systemRegion
        // A near tie means the winner was decided by the language weighting (or by population),
        // which is a guess: it is better to let the wizard ask the country than to silently keep
        // a wrong one. A region hint (pt-BR) or the OS region gives the winner a wide margin.
        const ambiguous = !!top && ranked.length > 1 && (top.score - ranked[1].score) <= 3
        this.isTrusted = !!top && !ambiguous && (regionMatches || (countriesTz.includes(top.code) && (ranked.length == 1 || top.code === primaryRegion)))
        return this.countryCode = top ? top.code : 'us';
    }
    /**
     * Scores every country implied by the system region and language hints and
     * returns them in descending order of confidence. The region setting of the
     * OS ("país ou região" on Windows, "Region" on macOS) is the strongest
     * signal, as it does not follow the display language; a region subtag such
     * as pt-BR comes next, and a bare language weighs the least because it is
     * shared by many countries. Hints earlier in the list (system preference
     * order) win over later ones. When at least one candidate matches the
     * timezone offset, countries outside it are discarded.
     */
    rankCountryCandidates(hints, countriesTz, systemRegion) {
        hints = hints || {}
        countriesTz = Array.isArray(countriesTz) ? countriesTz : []
        systemRegion = String(systemRegion || this.systemRegion || '').toLowerCase()
        if (!/^[a-z]{2}$/.test(systemRegion)) systemRegion = ''
        const scores = new Map()
        const add = (code, weight) => {
            if (!code || !this.countries.countryCodeExists(code)) return
            scores.set(code, (scores.get(code) || 0) + weight)
        }
        add(systemRegion, 12)
        ;(hints.countries || []).forEach((code, i) => add(code, Math.max(1, 6 - i)))
        const languages = (hints.langs || []).map(l => l.split('-')[0].toLowerCase()).unique()
        languages.forEach((code, i) => {
            const weight = Math.max(1, 3 - i)
            ;(this.countries.getCountriesFromLanguage(code) || []).forEach(country => add(country, weight))
        })
        let ranked = [...scores.entries()].map(([code, score]) => ({ code, score }))
        if (!ranked.length) { // no usable hint, fall back to the timezone offset
            ranked = countriesTz.map(code => ({ code, score: 0 }))
        } else {
            // drop countries outside the user timezone, keeping the OS region so it still
            // wins when the user is abroad
            const inTimezone = ranked.filter(c => c.code === systemRegion || countriesTz.includes(c.code))
            if (inTimezone.length) ranked = inTimezone
        }
        // ties are broken by population, the most likely country for a shared timezone offset
        ranked.forEach(c => {
            const country = this.countries.getCountry(c.code)
            c.population = (country && country.population) || 0
        })
        return ranked.sort((a, b) => (b.score - a.score) || (b.population - a.population))
    }
    async getCountriesLanguages(codes) {
        let languages = [];
        for (let code of codes) {
            let ls = this.countries.getCountryLanguages(code);
            if (Array.isArray(ls)) {
                ls.filter(l => !languages.includes(l)).forEach(l => languages.push(l));
            }
        }
        return languages;
    }
    async getCountries(locales) {
        if (!locales) {
            return this.countries.getCountries();
        }
        if (!Array.isArray(locales)) {
            locales = [locales];
        }
        return locales.map(loc => {
            return this.countries.getCountriesFromLanguage(loc);
        }).flat().unique();
    }
    async getActiveCountries(limit=8) {
        await this.ready()
        let actives = config.get('countries')
        if (!Array.isArray(actives) || !actives.length) {
            let languages = this.countries.getCountryLanguages(this.countryCode)
            actives = await this.getCountries(languages)
        }
        actives = this.countries.getNearestPopulous(this.countryCode, actives.filter(c => c != this.countryCode), (limit - 1) || 999)
        return [this.countryCode, ...actives]
    }
    async getCountriesMap(locale, additionalCountries) {
        const codes = await this.getCountries(locale);
        if (Array.isArray(additionalCountries)) {
            additionalCountries.forEach(c => {
                if (!codes.includes(c))
                    codes.push(c);
            });
        }
        return codes.map(code => {
            let name = this.countries.getCountryName(code, this.locale);
            if (name && name != code) {
                return { code, name };
            }
        }).sortByProp('name');
    }
    async asyncSome(arr, predicate) {
        for (let e of arr) {
            if (await predicate(e))
                return true;
        }
        return false;
    }
    async load(languageHint, explicitLanguage, folder, timezone, systemRegion) {
        this.folder = folder
        this.systemRegion = typeof systemRegion == 'string' && /^[A-Za-z]{2}$/.test(systemRegion) ? systemRegion.toLowerCase() : null
        const hints = this.normalizeLanguageHints(languageHint)
        if (explicitLanguage) {
            hints.unshift(explicitLanguage)
        }
        this.languageHints = hints.unique()
        // kept as a comma separated string for backwards compatibility (subtitles, options, multi-worker)
        this.languageHint = this.languageHints.join(', ')
        this.timezone = timezone
        await this.findLanguages().catch(err => console.error(err));
        this.locale = 'en';
        let utexts, texts = await this.loadLanguage('en').catch(e => {
            if (typeof menu !== 'undefined') {
                menu.displayErr(e)
            } else {
                console.error(e)
            }
        }); // english will be a base/fallback language for any key missing in translation chosen
        if (!texts) texts = {}
        await this.asyncSome(this.userAvailableLocales || ['en'], async (loc) => {
            if (loc == 'en')
                return true;
            utexts = await this.loadLanguage(loc).catch(err => console.error(err));
            if (utexts) {
                this.locale = loc;
                return true;
            }
        });
        await this.findCountryCode();
        if (moment?.tz?.setDefault && this.timezone?.name) {
            moment.tz.setDefault(this.timezone.name);
        }
        if (moment && typeof moment.locale === 'function') {
            const localeCandidates = [];
            if (this.locale) {
                if (this.countryCode) {
                    localeCandidates.push(`${this.locale}-${this.countryCode}`);
                }
                localeCandidates.push(this.locale);
            }
            const uniqueCandidates = [...new Set(localeCandidates)].filter(Boolean);
            if (uniqueCandidates.length) {
                moment.locale(uniqueCandidates);
            }
        }
        if (utexts)
            Object.assign(texts, utexts);
        this.applyTexts(texts);
        console.log('lang.load applyTexts done')
        this.ready.done()
        console.log('lang.load done')
        return texts;
    }
    applyTexts(texts) {
        this.textKeys = Object.keys(texts).map(k => k.toUpperCase()); // avoid a bad language file to mess with our class reserved properties
        this.textKeys.forEach(k => this[k] = texts[k]);
    }
    getTexts() {
        let ret = {};
        (this.textKeys || []).concat(['locale', 'countryCode']).forEach(k => ret[k] = this[k]);
        return ret;
    }
    normalizeLanguageHints(hint) {
        const raw = Array.isArray(hint) ? hint : String(hint || '').split(',')
        return raw.map(s => typeof s === 'string' ? s.trim().replace(/_/g, '-') : '').filter(Boolean)
    }
    parseLanguageHint(hint) {
        const hints = this.normalizeLanguageHints(hint);
        const countries = hints.map(s => {
            const parts = s.split('-').filter(Boolean);
            // a 2 letter subtag after the language is a region (pt-BR, zh-Hant-TW), even when it
            // is spelled like the language itself (pt-PT, es-ES)
            return parts.slice(1).find(p => /^[A-Za-z]{2}$/.test(p));
        }).filter(s => s).map(s => s.toLowerCase()).unique();
        // Generates candidates in priority order: the full tag (e.g. zh-TW)
        // comes before the 2-letter code (zh), allowing a specific locale
        // (zh-TW.json) to win over the generic one (zh.json) when the system
        // is set to Traditional Chinese (zh-TW / zh-Hant / zh-HK / zh-MO).
        const tags = [];
        for (const h of hints) {
            const parts = h.split('-').filter(Boolean);
            const base = (parts[0] || '').toLowerCase();
            if (!/^[a-z]{2,3}$/.test(base)) continue;
            const script = parts.slice(1).find(p => /^[A-Za-z]{4}$/.test(p)); // Hant, Hans...
            const region = parts.slice(1).find(p => /^[A-Za-z]{2}$/.test(p)); // TW, HK, CN...
            if (base === 'zh') {
                if (script && /^Hant$/i.test(script)) tags.push('zh-TW');
                else if (script && /^Hans$/i.test(script)) tags.push('zh');
                else if (region && /^(TW|HK|MO)$/i.test(region)) tags.push('zh-TW');
                else if (region && /^(CN|SG)$/i.test(region)) tags.push('zh');
                else if (parts.length === 2 && /^(TW|HK|MO)$/i.test(parts[1])) tags.push('zh-TW');
                else if (parts.length === 2 && /^(CN|SG)$/i.test(parts[1])) tags.push('zh');
                else if (parts.length === 2) tags.push(base + '-' + parts[1]);
            } else if (region) {
                tags.push(base + '-' + region);
            }
            tags.push(base);
        }
        const langs = tags.unique();
        return { langs, countries };
    }
    async availableLocalesMap() {
        if (!this._availableLocalesMap) {
            this._availableLocalesMap = {};
            let locales = this.userAvailableLocales.concat(this.availableLocales);
            locales.splice(1, 0, 'en');
            locales = locales.unique();
            for (let loc of locales) {
                let texts = await this.loadLanguage(loc).catch(err => console.error(err));
                if (texts) {
                    this._availableLocalesMap[loc] = texts.LANGUAGE_NAME || loc;
                }
            }
        }
        return this._availableLocalesMap;
    }
    async loadLanguage(locale) {        
        let file = path.join(this.folder, locale + '.json');
        let stat = await fs.promises.stat(file).catch(err => console.error(err));
        if (stat && stat.size) {
            let obj, content = await fs.promises.readFile(file, 'utf8');
            try {
                obj = parse(content);
                return obj;
            }
            catch (err) {
                throw err;
            }
        } else {
            throw 'Language file ' + file + ' unavailable';
        }
    }
}

export { Language }
export default new Language()
