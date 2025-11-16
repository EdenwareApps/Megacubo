import osd from '../osd/osd.js'
import fs from 'fs'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import path from "path";
import crashlog from "../crashlog/crashlog.js";
import config from "../config/config.js"
import paths from '../paths/paths.js'
import { EventEmitter } from "events";
import { Worker } from 'worker_threads';
import { basename, traceback } from '../utils/utils.js'
import { getDirname } from 'cross-dirname'           
import { parse, stringify } from '../serialize/serialize.js'

const dirname = getDirname()
const DEBUG = false
const TERMINATING = new Set(['destroy', 'terminate'])

const getLangObject = () => {
    const ret = {}
    
    // Only include properties actually used in the worker
    // These are the minimal properties needed for Language reconstruction
    ret.locale = lang.locale || config.get('locale', 'en')
    ret.timezone = lang.timezone || null
    ret.countryCode = lang.countryCode || config.get('country', 'us')
    ret.folder = lang.folder || null
    ret.languageHint = lang.languageHint || config.get('locale', 'en')
    
    return ret
}

class WorkerDriver extends EventEmitter {
    constructor() {
        super();
        this.iterator = 1
        this.err = null
        this.finished = false
        this.promises = {}
        this.instances = {}
        this.terminating = {}
    }
    proxy(file) {
        if (this.instances[file]) {
            return this.instances[file];
        }
        
        // Always create the proxy immediately, even if worker is not ready
        const self = this;
        const instance = new Proxy(this, {
            get: (_, method) => {
                const terminating = TERMINATING.has(method);
                if (terminating) {
                    self.terminating[file] = true;
                } else if (method in self) {
                    let ret = self[method];
                    if (typeof ret == 'function') {
                        ret = ret.bind(self);
                    }
                    return ret;
                } else if (method == 'toJSON') {
                    return () => JSON.stringify(null)
                }
                return (...args) => {
                    return new Promise((resolve, reject) => {
                        // If worker is not ready yet, queue the call
                        if (!self.workerReady) {
                            console.log(`🔄 Queuing worker call: ${file}.${method}`)
                            self.callQueue.push({ file, method, args, resolve, reject })
                            return
                        }
                        
                        // If this is the first call to this file and worker is ready, send loadWorker
                        if (self.worker && !self.loadWorkerSent.has(file)) {
                            console.log(`🔄 Sending loadWorker for ${file}`)
                            self.worker.postMessage({ method: 'loadWorker', file });
                            self.loadWorkerSent.add(file)
                            
                            // Queue this call to be processed after driver is loaded
                            console.log(`🔄 Queuing call ${file}.${method} until driver is loaded`)
                            self.callQueue.push({ file, method, args, resolve, reject })
                            return
                        }
                        
                        // If driver is not loaded yet, queue the call
                        if (self.worker && (!self.instances[file] || !self.instances[file]._driverLoaded)) {
                            console.log(`🔄 Queuing call ${file}.${method} until driver is loaded`)
                            self.callQueue.push({ file, method, args, resolve, reject })
                            return
                        }
                        
                        if (self.finished) {
                            try {
                                if (self.terminating[file]) {
                                    return resolve();
                                }
                            } catch (e) {
                                console.error('WORKER_ERR: '+ stringify(self));
                            }
                            return reject('worker already exited ' + file + ' ' + method);
                        }
                        const id = self.iterator;
                        self.iterator++;
                        self.promises[id] = {
                            resolve: ret => {
                                resolve(ret);
                                delete self.promises[id];
                                const pending = Object.values(self.promises).some(p => p.file == file);
                                if (!pending && self.terminating && self.terminating[file]) { // after resolve
                                    delete self.instances[file];
                                    delete self.terminating[file];
                                }
                            },
                            reject: err => {
                                reject(err);
                            },
                            file,
                            method
                        }
                        if (DEBUG) {
                            self.promises[id].traceback = traceback()
                        }
                        try {
                             self.worker.postMessage({ method, id, file, args });
                        } catch (e) {
                            console.error({ e, method, id, file, args });
                        }
                    });
                };
            }
        });            
        this.instances[file] = instance;
        
        // Add console log listeners for all workers
        this.instances[file].on('console-log', data => {
            // Only log if worker logs are enabled
            if (this.workerLogsEnabled) {
                // Only log if it's not a debug message or if debug is enabled
                if (!data.message.includes('[DEBUG]') || this.debug) {
                    console.log(`[${file}] ${data.message}`);
                }
            }
        });
        this.instances[file].on('console-error', data => {
            // Always log errors regardless of worker logs setting
            console.error(`[${file}] ${data.message}`, data.stack);
        });
        this.instances[file].on('console-warn', data => {
            // Always log warnings regardless of worker logs setting
            console.warn(`[${file}] ${data.message}`);
        });
        this.instances[file].on('console-info', data => {
            // Only log if worker logs are enabled
            if (this.workerLogsEnabled) {
                console.info(`[${file}] ${data.message}`);
            }
        });
        this.instances[file].on('console-debug', data => {
            // Only show debug messages if debug mode is enabled
            if (this.debug) {
                console.debug(`[${file}] ${data.message}`);
            }
        });
        
        return instance;
    }
    rejectAll(file, err) {
        Object.keys(this.promises).forEach(id => {
            if (!file || this.promises[id].file == file) {
                const terminating = TERMINATING.has(this.promises[id].method);
                if (terminating) {
                    this.promises[id].resolve()
                } else {
                    const method = this.promises[id] ? this.promises[id].method : ''
                    this.promises[id].reject(err +', while calling '+ method +' of '+ this.promises[id].file)
                }
                delete this.promises[id]
            }
        })
    }
    load(file, exclusive) {
        if (paths.inWorker) {
            throw 'Cannot load a worker inside another worker: ' + file +' '+ global.file
        }
        
        file = this.resolve(file)
        if(exclusive !== true && this.instances[file]) {
            return this.instances[file]
        }

        if(global.isExiting) {
            throw 'Worker already terminated: '+ file
        }
        
        // Always return a proxy immediately, even if worker is not ready
        // The proxy will buffer calls until worker is ready
        return this.proxy(file)
    }
    bindChangeListeners() {
        if(this.configChangeListener !== undefined) return
        this.on('config-change', data => {
            config.removeListener('change', this.configChangeListener)
            config.reload()
            config.on('change', this.configChangeListener)
        });
        this.on('storage-touch', async msg => {
            if(msg) {
                const changed = storage.validateTouchSync(msg.key, msg.entry)
                if (changed && changed.length) {
                    await storage.touch(msg.key, msg.entry).catch(err => console.error(err))
                }
            }
        })
        this.configChangeListener = () => {
            this.worker && this.worker.postMessage({ method: 'configChange', id: 0 });
        };
        this.langChangeListener = () => {
            const lang = getLangObject()
            this.worker && this.worker.postMessage({ method: 'langChange', id: 0, data: lang });
        };
        this.storageTouchListener = (key, entry) => {
            this.worker && this.worker.postMessage({ method: 'storageTouch', entry, key, id: 0 });
        };
        lang.on('ready', this.langChangeListener);
        config.on('change', this.configChangeListener);
        storage.on('touch', this.storageTouchListener);
    }
    resolve(file) {
        if(!file) return ''
        if(this.instances[file]) return file
        const b = basename(file).replace(new RegExp('\\.[a-z]*$'), '.')
        for(const iname of Object.keys(this.instances)) {
            if(iname.includes(b)) {
                return iname
            }
        }
        const distFile = paths.cwd +'/dist/'+ b +'js'
        if(b == 'premium' && !(process.argv.includes('--inspect') && fs.existsSync(distFile))) {
            file = distFile +'c'
        } else { // bytenode
            file = distFile
        }
        file = path.relative(dirname, file)
        return file
    }
    terminate() {
        this.finished = true;
        if (this.worker) {
            setTimeout(() => {
                const worker = this.worker
                this.worker = null
                if(worker) {
                    try {
                        worker.terminate().catch(err => console.error(err))
                    } catch {
                        console.error(e)
                    }
                }
                this.langChangeListener && lang.removeListener('ready', this.langChangeListener);
                this.configChangeListener && config.removeListener('change', this.configChangeListener);
                this.storageTouchListener && storage.removeListener('touch', this.storageTouchListener);
                this.removeAllListeners()
            }, 3000)
        }
        this.rejectAll(null, 'worker manually terminated')
    }
}

export default class ThreadWorkerDriver extends WorkerDriver {
    constructor() {
        super()
        this.worker = null
        this.workerData = null
        this.workerFile = null
        this.workerReady = false
        this.callQueue = [] // Buffer for calls made before worker is ready
        this.loadWorkerSent = new Set() // Track which workers have had loadWorker sent
        
        // Initialize worker asynchronously after language is ready
        this.initializeWorker()
    }
    
    async initializeWorker() {
        try {
            // Wait for language to be ready before creating worker
            console.log('🔧 Waiting for language to be ready before creating worker...')
            await lang.ready()
            console.log('🔧 Language is ready, creating worker...')
            
            // Check if worker was already terminated
            if (this.finished) {
                console.log('🔧 Worker already finished, skipping initialization')
                return
            }
            
            // Now create the worker with proper language data
            this.workerData = { paths, bytenode: true, android: !!paths.android, '$lang': getLangObject() }
            this.workerFile = paths.cwd +'/dist/worker.js'
            this.workerData.paths.android = !!paths.android
            
            // Add configuration for worker logging
            this.workerLogsEnabled = config.get('worker-logs-enabled', true)
            this.debug = config.get('worker-debug-enabled', false)
            
            console.log('🔧 Creating worker with data:', { 
                file: this.workerFile, 
                hasLangData: !!this.workerData.$lang,
                langData: this.workerData.$lang 
            })
            
            this.worker = new Worker(this.workerFile, {
                type: 'commonjs', // (file == distFile ? 'commonjs' : 'module'),
                workerData: this.workerData, // leave stdout/stderr undefined
                resourceLimits: {
                    maxOldGenerationSizeMb: 1024, // 1GB limit for old generation heap (increased for EPG processing)
                    maxYoungGenerationSizeMb: 128  // 128MB limit for young generation heap (increased)
                }
            })
            
            this.setupWorkerEventListeners()
            this.bindChangeListeners()
            
            // Mark worker as ready
            this.workerReady = true
            
            // Emit event that worker is ready
            this.emit('worker-ready')
            
            // Process queued calls
            console.log(`🔄 Processing ${this.callQueue.length} queued worker calls...`)
            const queueCopy = [...this.callQueue]
            this.callQueue = []
            
            // First, process all loadWorker calls
            const loadWorkerCalls = queueCopy.filter(call => call.method === 'loadWorker')
            const otherCalls = queueCopy.filter(call => call.method !== 'loadWorker')
            
            // Process loadWorker calls first
            for (const { file, method, args, resolve, reject } of loadWorkerCalls) {
                try {
                    console.log(`🔄 Processing queued loadWorker: ${file}`)
                    this.worker.postMessage({ method: 'loadWorker', file: args[0] })
                    // Resolve immediately to unblock the queue
                    resolve()
                } catch (error) {
                    reject(error)
                }
            }
            
            // Wait for drivers to load, then process other calls
            if (otherCalls.length > 0) {
                console.log(`🔄 Waiting 8 seconds for drivers to load, then processing ${otherCalls.length} calls...`)
                setTimeout(() => {
                    console.log('🔄 Processing queued calls after delay...')
                                        
                    // Check if worker still exists before processing
                    if (!this.worker) {
                        console.warn('⚠️ Worker was terminated before processing queued calls')
                        for (const { reject } of otherCalls) {
                            reject(new Error('Worker was terminated before processing queued calls'))
                        }
                        return
                    }
                    
                    for (const { file, method, args, resolve, reject } of otherCalls) {
                        try {
                            console.log(`🔄 Processing queued call: ${file}.${method}`)
                            const id = this.iterator++
                            this.promises[id] = {
                                resolve: ret => {
                                    resolve(ret)
                                    delete this.promises[id]
                                },
                                reject: err => {
                                    reject(err)
                                },
                                file,
                                method
                            }
                            this.worker.postMessage({ method, id, file, args })
                        } catch (error) {
                            reject(error)
                        }
                    }
                }, 8000) // 8 second delay to ensure drivers are loaded
            }
            
            console.log('✅ Worker initialized and ready')
            
            console.log('🔧 Worker created successfully with language data')
        } catch (error) {
            console.error('❌ Failed to initialize worker:', error.message)
            // Reject all queued calls
            while (this.callQueue.length > 0) {
                const { reject } = this.callQueue.shift()
                reject(new Error('Worker failed to initialize'))
            }
        }
    }
    
    setupWorkerEventListeners() {
        if (!this.worker) return
        this.worker.on('error', err => {
            let serr = String(err);
            this.err = err;
            console.error('error ' + err + ' ' + serr + ' ' + JSON.stringify(this.instances, null, 3), { err, serr });
            if (serr.match(new RegExp('(out of memory|out_of_memory)', 'i'))) {
                this.finished = true;
                let msg = 'Worker exited out of memory, fix the settings and restart the app.';
                osd.show(msg, 'fas fa-exclamation-triangle faclr-red', 'out-of-memory', 'long');
            }
            if (typeof(err.preventDefault) == 'function') {
                err.preventDefault();
            }
            crashlog.save('Worker error: ', err);
            this.rejectAll(null, 'worker exited out of memory');
        }, true, true);
        this.worker.on('exit', () => {
            this.finished = true;
            this.worker = null;
            this.workerReady = false;
            console.error('Worker exited', this.err, Object.keys(this.instances));
            this.rejectAll(null, this.err || 'worker exited');
        });
        this.worker.on('message', ret => {
            this.debug && console.log('🔍 MultiWorker: Received message:', { id: ret.id, file: ret.file, type: ret.type, dataLength: ret.data?.length })
            
            // Handle driver loading confirmations
            if (ret.type === 'driver-loaded') {
                console.log('✅ Driver loaded confirmation received:', ret.file)
                // Mark the driver as loaded in instances (don't overwrite the instance object)
                if (ret.file) {
                    // Ensure instance exists (create proxy if it doesn't exist yet)
                    if (!this.instances[ret.file]) {
                        console.log('🔧 Creating proxy for driver:', ret.file)
                        this.proxy(ret.file)
                    }
                    
                    // Mark as loaded without overwriting the instance object
                    if (this.instances[ret.file]) {
                        this.instances[ret.file]._driverLoaded = true
                        console.log('🔧 Updated instances:', Object.keys(this.instances))
                    } else {
                        console.error('❌ Failed to create instance for:', ret.file)
                    }
                    
                    // Process queued calls for this specific driver
                    const driverCalls = this.callQueue.filter(call => call.file === ret.file)
                    if (driverCalls.length > 0) {
                        console.log(`🔄 Processing ${driverCalls.length} queued calls for driver ${ret.file}`)
                        // Remove processed calls from queue
                        this.callQueue = this.callQueue.filter(call => call.file !== ret.file)
                        
                        // Process each queued call
                        for (const { file, method, args, resolve, reject } of driverCalls) {
                            try {
                                console.log(`🔄 Executing queued call: ${file}.${method}`)
                                const id = this.iterator++
                                this.promises[id] = {
                                    resolve: ret => {
                                        resolve(ret)
                                        delete this.promises[id]
                                    },
                                    reject: err => {
                                        reject(err)
                                        delete this.promises[id]
                                    },
                                    file,
                                    method
                                }
                                this.worker.postMessage({ method, id, file, args })
                            } catch (error) {
                                console.error(`❌ Error processing queued call ${file}.${method}:`, error)
                                reject(error)
                            }
                        }
                    }
                }
                return
            }
            
            if (ret.type === 'driver-load-error') {
                console.error('❌ Driver load error:', ret.file, ret.error)
                return
            }
            
            if (ret.id) {
                if (ret.id && typeof(this.promises[ret.id]) != 'undefined') {
                    if (ret.type == 'reject') {
                        const stack = this.promises[ret.id].traceback || ret.traceback || ret?.data?.stack || ''
                        ret.data = String(ret?.data?.message || ret.data) +'\n' + stack
                    }
                    this.promises[ret.id][ret.type](ret.data);
                    delete this.promises[ret.id];
                } else {
                    console.warn('Callback repeated', ret);
                }
            } else {
                let args = []
                let pos = (ret.data.length > 32 ? ret.data.substr(0, 32) : ret.data).indexOf(':');
                if (pos != -1) {
                    let evtType = ret.data.substr(0, pos);
                    let evtContent = ret.data.substr(pos + 1);
                    if (evtContent.length) {
                        evtContent = parse(evtContent);
                    }
                    if (typeof(evtContent) == 'object' && evtContent.type == 'Buffer') {
                        evtContent = Buffer.from(evtContent.data);
                    }
                    args = [evtType, evtContent];
                } else {
                    args = [ret.data];
                }
                const name = this.resolve(ret.file)
                this.debug && console.log('🔍 MultiWorker: Resolving event:', { name, hasInstance: !!this.instances[name], args })
                if (name && this.instances[name]) {
                    this.debug && console.log('🔍 MultiWorker: Emitting to instance:', name)
                    this.instances[name].emit(...args)
                } else {
                    this.debug && console.log('🔍 MultiWorker: Emitting to global')
                    this.emit(...args)
                }
            }
        });
        this.bindChangeListeners();
    }
        
    // Enable worker logs
    enableWorkerLogs() {
        this.workerLogsEnabled = true;
        console.log('Worker logs enabled');
    }
    
    // Disable worker logs
    disableWorkerLogs() {
        this.workerLogsEnabled = false;
        console.log('Worker logs disabled');
    }
    
    // Enable debug mode
    enableDebug() {
        this.debug = true;
        console.log('Worker debug mode enabled');
    }
    
    // Disable debug mode
    disableDebug() {
        this.debug = false;
        console.log('Worker debug mode disabled');
    }
    
    // Get current logging status
    getLoggingStatus() {
        return {
            workerLogsEnabled: this.workerLogsEnabled,
            debugEnabled: this.debug,
            activeWorkers: Object.keys(this.instances).length
        };
    }
}

