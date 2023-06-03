
const { workerData, parentPort } = require('worker_threads')
postMessage = parentPort.postMessage.bind(parentPort)

function logErr(data) {
    postMessage({id: 0, type: 'event', data: 'error:'+ JSON.stringify(data), file})
}

Object.keys(workerData).forEach(k => global[k] = workerData[k])

crashlog = require(global.APPDIR +'/modules/crashlog')

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

global.config = require(global.APPDIR + '/modules/config')(global.paths['data'] + '/config.json')
global.config.on('change', () => {
    parentPort.postMessage({id: 0, type: 'event', data: 'config-change'})
})

if(global.bytenode){
    global.bytenode = require('bytenode')
}

const Driver = require(file)
driver = new Driver()
parentPort.on('message', msg => {
    if(msg.method == 'configChange'){
        global.config.reload()
        setTimeout(() => {
            global.config.reload() // read again after some seconds, the config file may delay on writing
        }, 3000)
    } else if(typeof(driver[msg.method]) == 'undefined'){
        data = {id: msg.id, type: 'reject', data: 'method not exists'}
        parentPort.postMessage(data)
    } else {
        let type, data = null
        const promise = driver[msg.method].apply(driver, msg.args)
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

