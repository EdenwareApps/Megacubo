module.exports = opts => {
    const Storage = require('./storage')
    const storage = new Storage('', {clear: false, cleanup: opts.main || false})
    storage.temp = new Storage('', {temp: true, clear: opts.main || false, cleanup: false})  
    return storage
}
