
let workerData = JSON.parse(self.name)
if(workerData){
    Object.keys(workerData).forEach(k => global[k] = workerData[k])
}

function logErr(data){
    postMessage({id: 0, type: 'event', data: 'error:'+ JSON.stringify(data), file})
}

require('../supercharge')(global)

global.crashlog = require(global.APPDIR +'/modules/crashlog')
global.storage = require('../storage')({})
global.Download = require('../download')

const emit = (type, content) => {
	postMessage({id: 0, type: 'event', data: type +':'+ JSON.stringify(content)})
}

process.on('warning', e => {
    console.warn(e, e.stack)
})
process.on('unhandledRejection', (reason, promise) => {
    const msg = 'Unhandled Rejection at: '+ String(promise) + ', reason: '+ String(reason) + ' | ' + JSON.stringify(reason.stack)
    console.error(msg, promise, 'reason:', reason)
    crashlog.save('Unhandled Rejection at:', promise, 'reason:', reason)
    logErr(msg)
})
process.on('uncaughtException', (exception) => {
    const msg = 'uncaughtException: '+ exception.name + ' | ' + exception.message + ' | ' + JSON.stringify(exception.stack)
    console.error(msg)
    crashlog.save('uncaughtException', exception)
    logErr(msg)
    return false
})

global.config = require(global.APPDIR + '/modules/config')(global.paths['data'] + '/config.json')
global.config.on('change', () => {
    postMessage({id: 0, type: 'event', data: 'config-change'})
})

if(global.bytenode){
    global.bytenode = require('bytenode')
}

const Driver = require(file), driver = new Driver()
onmessage = e => {
    const msg = e.data
    if(msg.method == 'configChange'){
        global.config.reload()
    } else if(typeof(driver[msg.method]) == 'undefined'){
        console.error({msg, driver})
        postMessage({id: msg.id, type: 'reject', data: 'method not exists ' + JSON.stringify(msg) +' '+ global.traceback()})
    } else {
        let type, data = null
        let call = driver[msg.method].apply(driver, msg.args)
        if(call && call.then){
            call.then(ret => {
                type = 'resolve'
                data = ret
            }).catch(err => {
                type = 'reject'
                data = String(err)
            }).finally(() => {
                data = {id: msg.id, type, data}
                try {
                    postMessage(data)
                } catch(err) {
                    console.error('driver.postMessage error', err, data, file)
                }
            })
        }
    }
}

