
const fs = require('fs'), { workerData, parentPort } = require('worker_threads')

function logErr(data){
    parentPort.postMessage({id: -1, type: 'error', data})
}

process.on('unhandledRejection', (reason, promise) => {
    const msg = 'Unhandled Rejection at: '+String(promise)+ ', reason: '+ String(reason)
    logErr(msg)
})
process.on('uncaughtException', (exception) => {
    console.error(exception)
	const msg = 'uncaughtException: '+ exception.name + ' | ' + exception.message + ' | ' + JSON.stringify(exception.stack)
    logErr(msg)
    return false
})

Object.keys(workerData).forEach(k => global[k] = workerData[k])

const Config = require(APPDIR + '/modules/config')
global.config = new Config(global.paths['data'] + '/config.json')

if(global.bytenode){
    global.bytenode = require('bytenode')
}

const Driver = require(file), driver = new Driver()
parentPort.on('message', msg => {
    if(msg.method == 'configChange'){
        global.config.reload()
    } else if(typeof(driver[msg.method]) == 'undefined'){
        parentPort.postMessage({id: msg.id, type: 'reject', data: 'method not exists'})
    } else {
        let type, data = null
        driver[msg.method].apply(driver, msg.args).then(ret => {
            type = 'resolve'
            data = ret
        }).catch(err => {
            type = 'reject'
            data = err
        }).finally(() => {
            parentPort.postMessage({id: msg.id, type, data})
        })
    }
})

