import { moment, traceback } from '../utils/utils.js'
import utilsSetup from './utils.js'
import config from '../config/config.js'
import storage from '../storage/storage.js'
import crashlog from '../crashlog/crashlog.js'
import { getFilename } from 'cross-dirname'
import { createRequire } from 'node:module'
import { stringify } from "../serialize/serialize.js";
import { EventEmitter } from 'node:events'
import path from 'path'
import 'bytenode'
import lang from '../lang/lang.js'

EventEmitter.defaultMaxListeners = 100

const file = getFilename()
const DEBUG = false
const { logErr, parentPort, postMessage, loadGlobalVars } = utilsSetup(file)
const require = createRequire(file)

loadGlobalVars()

// Console interception to forward logs to main process
global.originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
}

// Override console methods to forward logs to main process ONLY
console.log = (...args) => {
    // Don't log locally in worker - only forward to main
    postMessage({ id: 0, file, type: 'event', data: 'console-log:' + JSON.stringify({ level: 'log', message: args.map(arg => String(arg)).join(' '), timestamp: new Date().toISOString() }) })
}

console.error = (...args) => {
    // Don't log locally in worker - only forward to main
    const stack = traceback()
    postMessage({ id: 0, file, type: 'event', data: 'console-error:' + JSON.stringify({ level: 'error', message: args.map(arg => String(arg)).join(' '), timestamp: new Date().toISOString(), stack }) })
}

console.warn = (...args) => {
    // Don't log locally in worker - only forward to main
    postMessage({ id: 0, file, type: 'event', data: 'console-warn:' + JSON.stringify({ level: 'warn', message: args.map(arg => String(arg)).join(' '), timestamp: new Date().toISOString() }) })
}

console.info = (...args) => {
    // Don't log locally in worker - only forward to main
    postMessage({ id: 0, file, type: 'event', data: 'console-info:' + JSON.stringify({ level: 'info', message: args.map(arg => String(arg)).join(' '), timestamp: new Date().toISOString() }) })
}

console.debug = (...args) => {
    // Don't log locally in worker - only forward to main
    postMessage({ id: 0, file, type: 'event', data: 'console-debug:' + JSON.stringify({ level: 'debug', message: args.map(arg => String(arg)).join(' '), timestamp: new Date().toISOString() }) })
}

global.lang = lang
global.config = config
global.storage = storage
global.crashlog = crashlog

let langListeners = []

// CRITICAL FIX: Reconstruct Language instance in worker from workerData
// This integrates with getLangObject() from multi-worker.js
async function setupLanguage() {
    try {
        console.log('🔧 Reconstructing Language...')
        
        // Validate required data
        if (!global.$lang) {
            console.error('❌ global.$lang is undefined')
            return false
        }
        
        // Check for required properties
        const languageHint = global.$lang.languageHint || 'en'
        const locale = global.$lang.locale || 'en'
        const folder = global.$lang.folder
        const timezone = global.$lang.timezone
        
        if (!folder) {
            console.error('❌ Language folder is undefined')
            return false
        }
        
        console.log(`🔧 Language data: hint=${languageHint}, locale=${locale}, folder=${folder} ${JSON.stringify(global.$lang)}`)
        
        await lang.load(languageHint, locale, folder, timezone)
        
        if (timezone && timezone.name) {
            moment.tz.setDefault(timezone.name)
        }
        if (locale && global.$lang.countryCode) {
            moment.locale([locale + '-' + global.$lang.countryCode, locale])
        }

        console.log(`📊 Reconstructed lang: locale=${lang.locale}, countryCode=${lang.countryCode}, ready=${lang.ready}`)
        
        // Verify that lang was properly initialized
        if (!lang.locale || !lang.countryCode) {
            console.error('❌ Lang loaded but missing locale or countryCode')
            return false
        }

        return true
    } catch (error) {
        console.error('❌ Failed to reconstruct Language instance:', error.message)
    }
}

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
    const msg = 'Unhandled Rejection at: ' + promise + ', reason: ' + (promise.$stack || reason.stack || '')
    console.error(msg)
    crashlog.save(msg)
    logErr(msg)

    // Handle database operation errors gracefully
    if (reason && reason.message && (
        reason.message.includes('Mutex acquisition timeout') ||
        reason.message.includes('file closed') ||
        reason.message.includes('Database is destroyed')
    )) {
        console.warn('Database operation error handled gracefully, continuing...')
        return // Don't crash the process
    }
})
process.on('uncaughtException', exception => {
    const msg = 'uncaughtException: ' + exception.name + ' | ' + exception.message + ' | ' + stringify(exception.stack)
    console.error(msg)
    crashlog.save(msg)
    logErr(msg)
    return false
})

const touchListener = (key, entry) => {
    postMessage({ id: 0, type: 'event', data: 'storage-touch:' + JSON.stringify({ key, entry }) })
}
const changeListener = () => {
    postMessage({ id: 0, type: 'event', data: 'config-change' })
}
config.on('change', changeListener)
storage.on('touch', touchListener)

const drivers = {}
const onMessage = msg => {
    if (Array.isArray(langListeners)) {
        // store messages while language is being reconstructed
        if (msg.method === 'loadWorker') {
            langListeners.unshift(msg)
        } else {
            langListeners.push(msg)
        }
        return
    }
    if (msg.file && !drivers[msg.file]) {
        for (const file of Object.keys(drivers)) {
            if (file.includes(msg.file)) {
                msg.file = file
                break
            }
        }
    }
    if (msg.method == 'configChange') {
        console.error('config-change', file, msg.args)
        config.removeListener('change', changeListener)
        config.reload(msg.args)
        config.on('change', changeListener)
    } else if (msg.method == 'langChange') {
        global.lang.load(msg.data.languageHint, msg.data.locale, msg.data.folder, msg.data.timezone)
        global.lang.timezone && moment.tz.setDefault(global.lang.timezone.name)
        global.lang.locale && moment.locale([global.lang.locale + '-' + global.lang.countryCode, global.lang.locale])

        // CRITICAL FIX: Reconstruct Language instance when language changes
        console.log('🔄 Language updated in worker', global.lang.locale, global.lang.countryCode, global.lang.timezone)
    } else if (msg.method == 'storageTouch') {
        const changed = storage.validateTouchSync(msg.key, msg.entry)
        if (changed && changed.length) {
            storage.touch(msg.key, msg.entry, true).catch(err => console.error(err))
        }
    } else if (msg.method == 'loadWorker') {
        console.log('🔧 Loading worker:', msg.file)
        if (!drivers[msg.file]) {
            const distFile = paths.cwd + '/dist/' + path.basename(msg.file).replace(new RegExp('\\.m?js$'), '.js')
            console.log('🔧 Dist file path:', distFile)
            try {
                const Driver = require(distFile)
                drivers[msg.file] = new Driver()
                console.log('✅ Worker loaded successfully:', msg.file)
                if (typeof (drivers[msg.file].terminate) != 'function') {
                    console.error('Warning: worker ' + msg.file + ' has no terminate() method.')
                }
                // Send confirmation back to main process
                postMessage({ type: 'driver-loaded', file: msg.file })
            } catch (e) {
                console.error("!! DRIVER NOT LOADED " + msg.file, e)
                console.error("Dist file path attempted:", distFile)
                console.error("Error details:", e.stack)
                // Send error back to main process
                postMessage({ type: 'driver-load-error', file: msg.file, error: e.message })
            }
        } else {
            console.log('🔧 Worker already loaded:', msg.file)
            // Send confirmation back to main process
            postMessage({ type: 'driver-loaded', file: msg.file })
        }
        // Don't process further, just load the driver
        return
    } else if (msg.method == 'memoryUsage') {
        const data = { id: msg.id, type: 'resolve', data: process.memoryUsage() }
        postMessage(data)
    } else if (!drivers[msg.file]) {
        console.error('❌ Worker not found:', msg.file)
        console.error('Available drivers:', Object.keys(drivers))
        console.error('Message:', JSON.stringify(msg))
        const data = { id: msg.id, type: 'reject', data: 'worker not found ' + JSON.stringify(msg) + ', drivers: ' + Object.keys(drivers).join('|') }
        postMessage(data)
    } else if (typeof (drivers[msg.file][msg.method]) == 'undefined') {
        const data = { id: msg.id, type: 'reject', data: 'method not exists ' + JSON.stringify(msg) }
        postMessage(data)
    } else {
        let type, data = null
        const promise = drivers[msg.file][msg.method].apply(drivers[msg.file], msg.args)
        if (!promise || typeof (promise.then) == 'undefined') {
            return postMessage({ id: -1, type: 'event', data: 'error: Not a promise (' + msg.method + ').' })
        }
        
        // Wrap promise handling to prevent unhandled rejections
        Promise.resolve(promise).then(ret => {
            type = 'resolve'
            data = ret
        }).catch(err => {
            type = 'reject'
            data = err
            // Log the error for debugging
            console.error('Worker method error:', msg.file, msg.method, err)
        }).finally(() => {
            const responseData = { id: msg.id, type, data }
            try {
                postMessage(responseData)
            } catch (e) {
                console.error('Error on postMessage:', msg.file, msg.method, type, e)
            }
        })
    }
}
parentPort.on('message', onMessage)

// Initialize language reconstruction
console.log('🔧 Starting language reconstruction...')

// Wait for language to be ready before setting up
async function initializeLanguage() {
    try {
        // Check if global.$lang has valid data
        if (!global.$lang || !global.$lang.folder) {
            console.log('🔧 Language data not ready, waiting for lang.ready()...')
            
            // Wait for language to be ready in the main process
            // This is a fallback mechanism - the main process should ensure $lang is populated
            console.log('🔧 Attempting to wait for language data...')
            
            // Try to wait a bit for the main process to populate $lang
            await new Promise(resolve => setTimeout(resolve, 1000))
            
            // Check again if $lang is now populated
            if (!global.$lang || !global.$lang.folder) {
                console.error('❌ Language data still not available after waiting')
                return false
            }
        }
        
        console.log('🔧 Language data available, proceeding with setup...')
        return await setupLanguage()
    } catch (error) {
        console.error('❌ Error during language initialization:', error.message)
        return false
    }
}

initializeLanguage().finally(() => {
    // Process pending language listeners safely
    console.log('🔧 Processing pending language listeners...', typeof langListeners)
    if (Array.isArray(langListeners)) {
        console.log(`🔧 Processing ${langListeners.length} pending language listeners`)
        const listeners = [...langListeners]
        langListeners = null
        while (listeners.length) {
            const msg = listeners.shift()
            try {
                if (msg && typeof msg === 'object') {
                    onMessage(msg)
                }
            } catch (e) {
                console.error('Error on langListeners:', e.message || e, msg)
            }
        }
        console.log('🔧 Pending language listeners processed')
    }
})