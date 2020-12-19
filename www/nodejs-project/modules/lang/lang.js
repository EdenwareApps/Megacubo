

const debug = false, path = require('path'), async = require('async'), fs = require('fs')

module.exports = (forceLocale, folder) => {
    let loadFile = file => {
        return new Promise((resolve, reject) => {
            fs.readFile(file, 'utf8', (err, data) => {
                if (err) {
                    resolve(false)
                } else {
                    let obj
                    try {
                        obj = JSON.parse(data)
                        resolve(obj)
                    } catch(err) {
                        resolve(false)
                    }
                }
            })
        })
    }
    let loadLanguage = (locales, folder) => {
        return new Promise((resolve, reject) => {
            let localeMask = path.join(folder, '{0}.json'), ret = {}, texts
            let doConcat = (texts, locale, cb) => {
                if(texts){
                    ret = Object.assign(texts, ret)
                    if(!ret.locale){
                        ret.locale = locale
                    }
                }
                if(typeof(cb) == 'function'){
                    cb()
                }
            }
            let run = (v, i, cb) => {
                if(locales.length){
                    let locale = locales.shift()
                    let file = localeMask.replace('{0}', locale)
                    if(debug){
                        console.log('Language loadFile', file)
                    }
                    let rnext = (texts) => {
                        if(debug){
                            console.log('Language loaded', locale, texts)
                        }
                        if(locale.length >= 5 && (!texts || typeof(texts) != 'object')){
                            locale = locale.substr(0, 2)
                            file = localeMask.replace('{0}', locale)
                            return loadFile(localeMask.replace('{0}', locale)).then(texts => {
                                if(debug){
                                    console.log('Language loaded', locale, texts)
                                }
                                doConcat(texts, locale, cb)
                            }).catch(err => {
                                doConcat(false, locale, cb)
                            })
                        } else {
                            doConcat(texts, locale, cb)
                        }
                    }
                    const fs = require('fs')
                    if(debug){
                        console.log('Language fs', file)
                    }
                    fs.stat(file, (err, stat) => {
                        if(debug){
                            console.log('Language loadFile ret', file, err, stat)
                        }
                        if(stat && stat.size){
                            loadFile(file).then(rnext).catch(err => {
                                console.error(err)
                                rnext(false)
                            })
                        } else { 
                            rnext(false)
                        }
                    })
                } else {
                    cb()
                }
            }
            async.eachOfLimit(locales, 1, run, () => {
                resolve(ret)
            })
        })
    }
    if(debug){
        console.log('Language loading...')
    }
    return new Promise((resolve, reject) => {
        if(debug){
            console.log('Language loading...')
        }
        let locales = ['en-US']
        const nx = (ret) => {
            if(debug){
                console.log('Loading language', locales.slice(0))
            }
            if(typeof(ret) == 'string' && (ret.length == 2 || ret.length == 5)){
                locales.unshift(ret)
            }
            let countryCode = locales[0]
            if(countryCode.length < 5){
                let flocs = locales.filter(l => l.length == 5 && l.substr(0, 2) == countryCode)
                if(flocs.length){
                    countryCode = flocs[0]
                }
            }
            countryCode = countryCode.substr(-2).toLowerCase()
            if(debug){
                console.log('Loading language', locales.slice(0))
            }
            loadLanguage(locales, folder).then(data => {
                data.countryCode = countryCode
                resolve(data)
            }).catch(reject)
        }
        if(debug){
            console.log('Language loading...', forceLocale, typeof(forceLocale))
        }
        if(forceLocale && typeof(forceLocale) == 'string'){
            nx(forceLocale)
        } else {
            console.error('No locale given')
            nx()
        }
    })
}