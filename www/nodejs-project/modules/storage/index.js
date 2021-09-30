module.exports = opts => {
    const Storage = require('./storage')
    const storage = new Storage('', {clear: false, cleanup: opts.main || false})
    storage.temp = new Storage('', {temp: true, clear: opts.main || false, cleanup: false})  
    storage.raw = new Storage('', {clear: false, cleanup: false}) 
    storage.rawTemp = new Storage('', {temp: true, clear: false, cleanup: false})  
    storage.raw.useJSON = false
    storage.rawTemp.useJSON = false
    return storage
}
