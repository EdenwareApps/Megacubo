

const debug = false, path = require('path'), fs = require('fs'), async = require('async'), Events = require('events'), Countries = require('../countries')

class Language extends Events {
    constructor(languageHint, explicitLanguage, folder){
        super()
        this.folder = folder
        if(explicitLanguage){
            languageHint = explicitLanguage +', '+ languageHint
        }
        this.findLanguages(languageHint)
        this.cl = require('country-language')
        this.countries = new Countries()
        this.isReady = false
    }
    ready(cb){
        if(this.isReady){
            cb()
        } else {
            this.on('ready', cb)
        }
    }
    async findLanguages(languageHint){
        let files = await fs.promises.readdir(this.folder).catch(global.displayErr)
        this.availableLocales = files.filter(f => f.substr(-5).toLowerCase() == '.json').map(f => f.split('.').shift())
        this.userLocales = this.parseLanguageHint(languageHint)
        this.userAvailableLocales = this.userLocales.filter(l => this.availableLocales.includes(l))
        return this.userLocales
    }
    async findCountryCode(){
        let loc, maybeLoc = []
        let countries = global.config.get('countries')
        if(!countries || !countries.length){
            countries = await this.getCountriesFromLanguage(this.locale)
        }
        if(countries.length == 1){
            loc = countries[0]
        } else {
            this.userLocales.filter(l => l.length == 5).some(l => {
                let ll = l.substr(-2).toLowerCase()
                if(l.substr(0, 2) == this.locale || countries.includes(ll)){
                    loc = ll
                    return true
                } else {
                    maybeLoc.push(ll)
                }
            })
        }
        if(!loc){
            maybeLoc = maybeLoc.filter(l => this.cl.countryCodeExists(l))
            if(maybeLoc.length){
                loc = maybeLoc.shift()
            } else {
                loc = this.locale
            }
        }
        this.countryCode = loc
    }
    getCountryLanguages(code){
        return new Promise((resolve, reject) => {
            this.cl.getCountryLanguages(code, (err, countries) => {
                if(err){
                    return reject(err)
                }
                resolve(countries.map(r => r.iso639_1).filter(r => r))
            })
        })
    }
    async getCountriesLanguages(codes){
        let languages = []
        for(let code of codes){
            let ls = await this.getCountryLanguages(code).catch(console.error)
            if(Array.isArray(ls)){
                ls.filter(l => !languages.includes(l)).forEach(l => languages.push(l))
            }
        }
        return languages
    }
    async getCountries(locales){ // return countries of same ui languageS
        if(!locales){
            return this.cl.getCountries().map(l => l.code_2.toLowerCase())
        }
        const countries = []
        if(!Array.isArray(locales)){
            locales = [locales]
        }
        await Promise.allSettled(locales.map(async loc => {
            const cs = await this.getCountriesFromLanguage(loc).catch(console.error)
            if(Array.isArray(cs)){
                cs.forEach(c => {
                    if(!countries.includes(c)) countries.push(c)
                })
            }
        }))
        return countries
    }
    getCountriesFromLanguage(locale){ // return countries of same ui language
        return new Promise((resolve, reject) => {
            global.lang.cl.getLanguage(locale, (err, language) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(language.countries.map(l => l.code_2.toLowerCase()))
                }
            })
        })
    }
    async getActiveCountries(){
        let actives = global.config.get('countries')
        if(!Array.isArray(actives) || !actives.length){
            let languages = await this.getCountryLanguages(this.countryCode)
            actives = await this.getCountries(languages)
            if(!actives.includes(this.countryCode)){
                actives.push(this.countryCode)
            }
        }
        return actives
    }
    async getActiveLanguages(){
        return await this.getCountriesLanguages(await this.getActiveCountries())
    }
    getCountriesMap(locale, additionalCountries){ // return countries of same ui language
        return new Promise((resolve, reject) => {
            this.getCountries(locale).then(codes => {
                this.countries.ready().then(() => {
                    let entries = []
                    if(Array.isArray(additionalCountries)) {
                        additionalCountries.forEach(c => {
                            if(!codes.includes(c)) codes.push(c)
                        })
                    }
                    async.eachOf(codes, (code, i, done) => {
                        let name = this.countries.nameFromCountryCode(code, this.locale)
                        if(name && name != code){
                            entries.push({code, name})
                            done()
                        } else {
                            this.cl.getCountry(code.toUpperCase(), (err, data) => {
                                entries.push({
                                    name: data && data.name ? data.name : code,
                                    code
                                })
                                done()
                            })
                        }
                    }, () => {
                        resolve(entries.sortByProp('name'))
                    })
                }).catch(reject)  
            }).catch(reject)
        })
    }
    async asyncSome(arr, predicate){
        for (let e of arr) {
            if (await predicate(e)) return true
        }
        return false
    }
    async load(){
        this.locale = 'en'
        let utexts, texts = await this.loadLanguage('en').catch(global.displayErr) // english will be a base/fallback language for any key missing in translation chosen
        if(!texts) texts = {}
        await this.asyncSome(this.userAvailableLocales, async loc => {
            if(loc == 'en') return true
            utexts = await this.loadLanguage(loc).catch(console.error)
            if(utexts){
                this.locale = loc
                return true
            }
        })
        await this.findCountryCode()
        if(utexts) Object.assign(texts, utexts)
        this.applyTexts(texts)
        this.isReady = true
        this.emit('ready')
        return texts
    }
    applyTexts(texts){
        this.textKeys = Object.keys(texts).map(k => k.toUpperCase()) // avoid a bad language file to mess with our class reserved properties
        this.textKeys.forEach(k => this[k] = texts[k])
    }
    getTexts(){
        let ret = {};
        (this.textKeys || []).concat(['locale', 'countryCode']).forEach(k => ret[k] = this[k])
        return ret
    }
    parseLanguageHint(hint){
        let retLocales = [], locales = hint.replace(new RegExp(' +', 'g'), '').split(',').filter(s => [2, 5].includes(s.length))
        locales.forEach(loc => {
            retLocales.push(loc)
            if(loc.length == 5){
                retLocales.push(loc.substr(-2).toLowerCase())
                retLocales.push(loc.substr(0, 2).toLowerCase())
            }
        })
        return [...new Set(retLocales)]
    }
    async availableLocalesMap(){
        if(!this._availableLocalesMap){
            this._availableLocalesMap = {}
            let locales = this.userAvailableLocales.concat(this.availableLocales)
            locales.splice(1, 0, 'en')
            locales = [...new Set(locales)]
            for(let loc of locales){
                let texts = await this.loadLanguage(loc).catch(console.error)
                if(texts){
                    this._availableLocalesMap[loc] = texts.LANGUAGE_NAME || loc
                }
            }
        }
        return this._availableLocalesMap
    }
    async loadLanguage(locale){
        let file = path.join(this.folder, locale +'.json')
        let stat = await fs.promises.stat(file).catch(console.error)
        if(stat && stat.size){
            let obj, content = await fs.promises.readFile(file, 'utf8')
            try {
                obj = global.parseJSON(content)
                return obj
            } catch(err) {
                throw err
            }
        } else {
            throw 'Language file '+ file +' unavailable'
        }
    }   
}

module.exports = Language
