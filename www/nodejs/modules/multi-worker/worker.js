const { logErr, parentPort, loadGlobalVars } = require('./utils')(__filename)

loadGlobalVars()
require('../supercharge')(global)

global.config = require(paths.cwd + '/modules/config')(paths.data + '/config.json')

const Storage = require('../storage')
const crashlog = require('../crashlog')

process.on('warning', e => {
    console.warn(e, e.stack)
})
process.on('unhandledRejection', (reason, promise) => {
    const msg = 'Unhandled Rejection at: '+ String(promise)+ ', reason: '+ String(reason) + ' | ' + JSON.stringify(reason.stack)
    console.error(msg, promise, 'reason:', reason)
    crashlog.save('Unhandled Rejection at:', promise, 'reason:', reason)
    logErr(msg)
})
process.on('uncaughtException', (exception) => {
    const msg = 'uncaughtException: '+ exception.name + ' | ' + exception.message + ' | ' + JSON.stringify(exception.stack)
    console.error('uncaughtException', exception)
    crashlog.save('uncaughtException', exception)
    logErr(msg)
    return false
})

global.storage = new Storage({})

global.config.on('change', () => {
    parentPort.postMessage({id: 0, type: 'event', data: 'config-change'})
})
global.storage.on('touch', (key, entry) => {
    parentPort.postMessage({id: 0, type: 'event', data: 'storage-touch:'+ JSON.stringify({key, entry})})
})

global.Download = require('../download')

if(global.bytenode){
    global.bytenode = require('bytenode')
}

const drivers = {}
parentPort.on('message', msg => {
    if(msg.method == 'configChange'){
        // delay for some seconds, the config file may delay on writing
        setTimeout(() => global.config.reload(), 1000)
    } else if(msg.method == 'storageTouch'){
        global.storage.touch(msg.key, msg.entry, true)
    } else if(msg.method == 'loadWorker') {
        const Driver = require(msg.file)
        drivers[msg.file] = new Driver()
        if(typeof(drivers[msg.file].terminate) != 'function') {
            console.error('Warning: worker '+ msg.file +' has no terminate() method.')
        }
    } else if(!drivers[msg.file]) {
        data = {id: msg.id, type: 'reject', data: 'worker not found '+ JSON.stringify(msg)}
        parentPort.postMessage(data)
    } else if(typeof(drivers[msg.file][msg.method]) == 'undefined'){
        data = {id: msg.id, type: 'reject', data: 'method not exists '+ JSON.stringify(msg)}
        parentPort.postMessage(data)
    } else {
        let type, data = null
        const promise = drivers[msg.file][msg.method].apply(drivers[msg.file], msg.args)
        if(!promise || typeof(promise.then) == 'undefined'){
            data = {id: -1, type: 'event', data: 'error: Not a promise ('+ msg.method +').'}
            return parentPort.postMessage(data)
        }
        promise.then(ret => {
            type = 'resolve'
            data = ret
        }).catch(err => {
            type = 'reject'
            data = err
        }).finally(() => {
            data = {id: msg.id, type, data}
            parentPort.postMessage(data)
        })
    }
})

