import '../utils/utils.js'
import utilsSetup from './utils.js'
import storage from '../storage/storage.js'
import crashlog from '../crashlog/crashlog.js'
import config from "../config/config.js"
import { getFilename } from 'cross-dirname'  
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import 'bytenode'

const { logErr, parentPort, loadGlobalVars } = utilsSetup(getFilename())
const require = createRequire(getFilename())

loadGlobalVars()

process.on('warning', e => console.warn(e, e.stack))
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

config.on('change', () => {
    parentPort.postMessage({id: 0, type: 'event', data: 'config-change'})
})
storage.on('touch', (key, entry) => {
    parentPort.postMessage({id: 0, type: 'event', data: 'storage-touch:'+ JSON.stringify({key, entry})})
})

const drivers = {}
parentPort.on('message', msg => {
    try {
    if(msg.method == 'configChange'){
        // delay for some seconds, the config file may delay on writing
        setTimeout(() => config.reload(), 1000)
    } else if(msg.method == 'storageTouch'){
        storage.touch(msg.key, msg.entry, true)
    } else if(msg.method == 'loadWorker') {
        const distFile = paths.cwd +'/dist/'+ path.basename(msg.file).replace(new RegExp('\\.m?js$'), '.js')
        if(fs.existsSync(distFile)) {
            try {
                const Driver = require(distFile)
                drivers[msg.file] = new Driver()
                console.error("::::::::::: DRIVER LOADED "+ msg.file +" - "+ Object.keys(drivers[msg.file]).join(','))
            } catch(e) {
                console.error("::::::::::: DRIVER NOT LOADED "+ msg.file +" - "+ e)
            }
            if(typeof(drivers[msg.file].terminate) != 'function') {
                console.error('Warning: worker '+ msg.file +' has no terminate() method.')
            }
        } else { // for now nodejs is problematic with ES6 + worker_threads + import()
            console.error("::::::::::: DRIVER LOAD ERROR, FILE NOT FOUND: "+ distFile)
        }
    } else if(!drivers[msg.file]) {
        let data
        data = {id: msg.id, type: 'reject', data: 'worker not found '+ JSON.stringify(msg) +', drivers: '+ Object.keys(drivers).join('|')}
        parentPort.postMessage(data)
    } else if(typeof(drivers[msg.file][msg.method]) == 'undefined'){
        let data
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
} catch(e) {
    console.error(e)
}
})

