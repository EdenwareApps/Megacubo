import { EventEmitter } from 'node:events';
import Countries from "../countries/countries.js";
import fs from "fs";
import path from "path";
import config from "../config/config.js"
import { parse } from '../serialize/serialize.js'
import ready from '../ready/ready.js'
import { moment } from '../utils/utils.js'

class Language extends EventEmitter {
    constructor() {
        super()
        this.countries = new Countries()
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
        this.hints = this.parseLanguageHint(this.languageHint);
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
        const countriesHintsTz = this.hints.countries.filter(c => countriesTz.includes(c));
        if (force !== true) {
            const country = config.get('country');
            if (country) {
                this.isTrusted = true;
                this.alternateCountries = countriesHintsTz.filter(c => c != country);
                this.countryCode = country;
                return this.countryCode;
            }
        }
        if (countriesHintsTz.length) { // country in navigator hints, right timezone
            this.alternateCountries = countriesHintsTz;
            this.isTrusted = this.alternateCountries.length == 1;
            return this.countryCode = this.alternateCountries.shift();
        }
        const countriesTzAllLangs = this.hints.langs.map(l => this.countries.getCountriesFromLanguage(l)).flat().filter(c => countriesTz.includes(c)); // country should be in tz
        if (countriesTzAllLangs.length) { // language in navigator hints, right timezone
            this.alternateCountries = countriesTzAllLangs.unique();
            this.isTrusted = this.alternateCountries.length == 1;
            return this.countryCode = this.alternateCountries.shift();
        }
        if (this.hints.countries.length) { // country in navigator hints, wrong timezone
            this.alternateCountries = this.hints.countries.slice(0);
            this.isTrusted = false;
            return this.countryCode = this.alternateCountries.shift();
        }
        this.alternateCountries = [];
        return this.countryCode = 'us';
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
    async load(languageHint, explicitLanguage, folder, timezone) {
        this.folder = folder
        if (explicitLanguage) {
            languageHint = explicitLanguage + ', ' + languageHint
        }
        this.languageHint = languageHint
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
    parseLanguageHint(hint) {
        const hints = hint.split(',').map(s => s.trim());
        const countries = hints.map(s => s.length === 5 ? s.substr(3).toLowerCase() : false).filter(s => s).unique();
        const langs = hints.map(s => s.substr(0, 2)).unique();
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
