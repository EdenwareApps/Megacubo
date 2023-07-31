const Cloud = require('../cloud')
const { logErr, parentPort, loadGlobalVars } = require('./utils')(__filename)

loadGlobalVars()
require('../supercharge')(global)

process.on('warning', e => {
    console.warn(e, e.stack)
})
process.on('unhandledRejection', (reason, promise) => {
    const msg = 'Unhandled Rejection at: '+String(promise)+ ', reason: '+ String(reason) + ' | ' + JSON.stringify(reason.stack)
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

global.crashlog = require(global.APPDIR +'/modules/crashlog')
global.storage = require('../storage')({})

global.config = require(global.APPDIR + '/modules/config')(global.paths['data'] + '/config.json')
global.config.on('change', () => {
    parentPort.postMessage({id: 0, type: 'event', data: 'config-change'})
})

global.Download = require('../download')
global.cloud = new Cloud()

if(global.bytenode){
    global.bytenode = require('bytenode')
}

const drivers = {}

parentPort.on('message', msg => {
    if(msg.method == 'configChange'){
        global.config.reload()
        setTimeout(() => {
            global.config.reload() // read again after some seconds, the config file may delay on writing
        }, 3000)
    } else if(msg.method == 'loadWorker') {
        const Driver = require(msg.file)
        drivers[msg.file] = new Driver()
        if(typeof(drivers[msg.file].terminate) != 'function') {
            console.error('Warning: worker '+ msg.file +' has no terminate() method.')
        }
    } else if(typeof(drivers[msg.file][msg.method]) == 'undefined'){
        data = {id: msg.id, type: 'reject', data: 'method not exists ' + JSON.stringify(msg)}
        parentPort.postMessage(data)
    } else {
        let type, data = null
        const promise = drivers[msg.file][msg.method].apply(drivers[msg.file], msg.args)
        if(!promise || typeof(promise.then) == 'undefined'){
            data = {id: -1, type: 'event', data: 'error:Not a promise ('+ msg.method +').'}
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

