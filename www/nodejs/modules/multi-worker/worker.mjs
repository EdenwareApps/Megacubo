import { moment, traceback } from '../utils/utils.js'
import utilsSetup from './utils.js'
import config from '../config/config.js'
import storage from '../storage/storage.js'
import crashlog from '../crashlog/crashlog.js'
import { getFilename } from 'cross-dirname'  
import { createRequire } from 'node:module'
import { stringify } from "../serialize/serialize.js";
import { EventEmitter } from 'events'
import path from 'path'
import 'bytenode'

EventEmitter.defaultMaxListeners = 100

const file = getFilename()
const DEBUG = false
const { logErr, parentPort, postMessage, loadGlobalVars } = utilsSetup(file)
const require = createRequire(file)

loadGlobalVars()

global.config = config
global.storage = storage
global.crashlog = crashlog

lang.timezone && moment.tz.setDefault(lang.timezone.name)
lang.locale && moment.locale([lang.locale +'-'+ lang.countryCode, lang.locale])

if (DEBUG) {
    const OldPromise = global.Promise; 
    global.Promise = class Promise extends OldPromise {
        constructor(executor) {
            super(executor);
            this.$stack = traceback();
        }
    };
}

const red = '\x1b[31m%s\x1b[0m'
const yellow = '\x1b[33m%s\x1b[0m'

process.on('warning', e => {
    console.warn(yellow, 'Process warning: ', e, e.stack)
})
process.on('unhandledRejection', (reason, promise) => {
    const msg = 'Unhandled Rejection at: '+ promise+ ', reason: '+ (promise.$stack || reason.stack || '')
    console.error(msg)
    crashlog.save(msg)
    logErr(msg)
})
process.on('uncaughtException', exception => {
    const msg = 'uncaughtException: '+ exception.name + ' | ' + exception.message + ' | ' + stringify(exception.stack)
    console.error(msg)
    crashlog.save(msg)
    logErr(msg)
    return false
})

const touchListener = (key, entry) => {
    postMessage({id: 0, type: 'event', data: 'storage-touch:'+ JSON.stringify({key, entry})})
}
const changeListener = () => {
    postMessage({id: 0, type: 'event', data: 'config-change'})
}
config.on('change', changeListener)
storage.on('touch', touchListener)

const drivers = {}
parentPort.on('message', msg => {
    if(msg.method == 'configChange'){
        console.error('config-change', file, msg.args)
        config.removeListener('change', changeListener)
        config.reload(msg.args)
        config.on('change', changeListener)
    } else if(msg.method == 'langChange'){
        global.lang = msg.data
        global.lang.timezone && moment.tz.setDefault(global.lang.timezone.name)
        global.lang.locale && moment.locale([global.lang.locale +'-'+ global.lang.countryCode, global.lang.locale])
    } else if(msg.method == 'storageTouch'){
        const changed = storage.validateTouchSync(msg.key, msg.entry)
        if (changed && changed.length) {
            storage.touch(msg.key, msg.entry, true).catch(err => console.error(err))
        }
    } else if(msg.method == 'loadWorker') {
        if(!drivers[msg.file]) {
            const distFile = paths.cwd +'/dist/'+ path.basename(msg.file).replace(new RegExp('\\.m?js$'), '.js')
            try {
                const Driver = require(distFile)
                drivers[msg.file] = new Driver()
                if(typeof(drivers[msg.file].terminate) != 'function') {
                    console.error('Warning: worker '+ msg.file +' has no terminate() method.')
                }
            } catch(e) {
                console.error("!! DRIVER NOT LOADED "+ msg.file, e)
            }
        }
    } else if(msg.method == 'memoryUsage'){
        const data = {id: msg.id, type: 'resolve', data: process.memoryUsage()}
        postMessage(data)
    } else if(!drivers[msg.file]) {
        const data = {id: msg.id, type: 'reject', data: 'worker not found '+ JSON.stringify(msg) +', drivers: '+ Object.keys(drivers).join('|')}
        postMessage(data)
    } else if(typeof(drivers[msg.file][msg.method]) == 'undefined'){
        const data = {id: msg.id, type: 'reject', data: 'method not exists '+ JSON.stringify(msg)}
        postMessage(data)
    } else {
        let type, data = null
        const promise = drivers[msg.file][msg.method].apply(drivers[msg.file], msg.args)
        if(!promise || typeof(promise.then) == 'undefined'){
            return postMessage({id: -1, type: 'event', data: 'error: Not a promise ('+ msg.method +').'})
        }
        promise.then(ret => {
            type = 'resolve'
            data = ret
        }).catch(err => {
            type = 'reject'
            data = err
        }).finally(() => {
            data = {id: msg.id, type, data}
            try {
                postMessage(data)
            } catch(e) {
                console.error('Error on postMessage:', msg.file, msg.method, type, e)
            }
        })
    }
})

