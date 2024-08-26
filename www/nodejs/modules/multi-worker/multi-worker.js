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
import { basename, parseJSON } from '../utils/utils.js'
import { getDirname } from 'cross-dirname'           

const dirname = getDirname()

/* Worker to update lists in background
function wrapAsBase64(file){
    // workaround, macos throws not found for local files when calling Worker
    // TODO: maybe file:// could have solved that too
    return String(fs.readFileSync(file))
}
*/
const setupConstructor = () => {
    const workerData = { paths };
    workerData.paths.android = !!paths.android;
    if (typeof (lang) != 'undefined' && typeof (lang.getTexts) == 'function') {
        workerData.lang = lang.getTexts();
    } else {
        workerData.lang = {};
    }
    workerData.bytenode = true;
    class WorkerDriver extends EventEmitter {
        constructor() {
            super();
            this.iterator = 1;
            this.err = null;
            this.finished = false;
            this.promises = {};
            this.instances = {};
            this.terminating = {};
        }
        proxy(file) {
            //file = path.resolve(file);
            if (this.instances[file]) {
                return this.instances[file];
            }
            this.worker.postMessage({ method: 'loadWorker', file });
            const self = this;
            const instance = new Proxy(this, {
                get: (_, method) => {
                    const terminating = ['destroy', 'terminate'].includes(method);
                    if (terminating) {
                        self.terminating[file] = true;
                    } else if (method in self) {
                        return self[method];
                    } else if (method == 'toJSON') {
                        return () => JSON.stringify(null);
                    }
                    return (...args) => {
                        return new Promise((resolve, reject) => {
                            if (self.finished) {
                                try {
                                    if (self.terminating[file]) {
                                        return resolve();
                                    }
                                }
                                catch (e) {
                                    console.error('WORKER_ERR: ' + crashlog.stringify(self));
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
                            };
                            try {
                                self.worker.postMessage({ method, id, file, args });
                            }
                            catch (e) {
                                console.error({ e, method, id, file, args });
                            }
                        });
                    };
                }
            });
            this.instances[file] = instance;
            return instance;
        }
        rejectAll(file, err) {
            Object.keys(this.promises).forEach(id => {
                if (!file || this.promises[id].file == file) {
                    const terminating = ['destroy', 'terminate'].includes(this.promises[id].method);
                    if (terminating) {
                        this.promises[id].resolve();
                    } else {
                        const method = this.promises[id] ? this.promises[id].method : '';
                        this.promises[id].reject(err + ', while calling ' + method);
                    }
                    delete this.promises[id];
                }
            })
        }
        load(file, exclusive) {
            if (this.worker) {
                file = this.resolve(file)
                console.error('WORKER LOAD: ', {file, exclusive, inWorker: !!paths.inWorker, exists: !!this.instances[file], instances: Object.keys(this.instances)})
                if(exclusive !== true && this.instances[file]) {
                    return this.instances[file]
                }
                return this.proxy(file)
            } else {
                throw 'Worker already terminated: ' + file;
            }
        }
        bindChangeListeners() {
            this.on('config-change', data => {
                //console.log('Config changed from worker driver', data)
                config.reload();
            });
            this.on('storage-touch', msg => {
                msg && storage.touch(msg.key, msg.entry, true);
            });
            this.configChangeListener = () => {
                this.worker && this.worker.postMessage({ method: 'configChange', id: 0 });
            };
            this.storageTouchListener = (key, entry) => {
                this.worker && this.worker.postMessage({ method: 'storageTouch', entry, key, id: 0 });
            };
            config.on('change', this.configChangeListener);
            storage.on('touch', this.storageTouchListener);
        }
        resolve(file) {
            if(!file) return ''
            if(this.instances[file]) return file
            const b = basename(file).replace(new RegExp('\\.[a-z]*$'), '.')
            for(const iname of Object.keys(this.instances)) {
                if(iname.indexOf(b) != -1) {
                    return iname
                }
            }
            const distFile = paths.cwd +'/dist/'+ basename(file).replace(new RegExp('\\.m?js$'), '.js')
            if(fs.existsSync(distFile)) {
                file = distFile
            } else if(fs.existsSync(distFile +'c')) { // bytenode
                file = distFile +'c'
            }
            file = path.relative(dirname, file)
            return file
        }
        terminate() {
            this.finished = true;
            this.configChangeListener && config.removeListener('change', this.configChangeListener);
            this.storageTouchListener && storage.removeListener('touch', this.storageTouchListener);
            if (this.worker) {
                setTimeout(() => {
                    const worker = this.worker
                    this.worker = null
                    if(worker) {
                        try {
                            worker.terminate().catch(console.error)
                        } catch {
                            console.error(e)
                        }
                    }
                }, 3000)
            }
            this.rejectAll(null, 'worker manually terminated')
            this.removeAllListeners()
        }
    }
    class ThreadWorkerDriver extends WorkerDriver {
        constructor() {
            super()
            //let file = paths.cwd +'/modules/multi-worker/worker.mjs'
            const file = paths.cwd +'/dist/worker.js'
            this.worker = new Worker(file, {
                type: 'commonjs', // (file == distFile ? 'commonjs' : 'module'),
                workerData // leave stdout/stderr undefined
            })
            this.worker.on('error', err => {
                let serr = String(err);
                this.err = err;
                console.error('error ' + err + ' ' + serr + ' ' + JSON.stringify(this.instances, null, 3), { err, serr });
                if (serr.match(new RegExp('(out of memory|out_of_memory)', 'i'))) {
                    this.finished = true;
                    let msg = 'Worker exited out of memory, fix the settings and restart the app.';
                    osd.show(msg, 'fas fa-exclamation-triangle faclr-red', 'out-of-memory', 'long');
                }
                if (typeof (err.preventDefault) == 'function') {
                    err.preventDefault();
                }
                crashlog.save('Worker error: ', err);
                this.rejectAll(null, 'worker exited out of memory');
            }, true, true);
            this.worker.on('exit', () => {
                this.finished = true;
                this.worker = null;
                console.error('Worker exited', this.err);
                this.rejectAll(null, this.err || 'worker exited');
            });
            this.worker.on('message', ret => {
                if (ret.id) {
                    if (ret.id && typeof (this.promises[ret.id]) != 'undefined') {
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
                            evtContent = parseJSON(evtContent);
                        }
                        if (typeof (evtContent) == 'object' && evtContent.type == 'Buffer') {
                            evtContent = Buffer.from(evtContent.data);
                        }
                        args = [evtType, evtContent];
                    } else {
                        args = [ret.data];
                    }
                    const name = this.resolve(ret.file)
                    if (name && this.instances[name]) {
                        this.instances[name].emit(...args)
                    } else {
                        this.emit(...args)
                    }
                }
            });
            this.bindChangeListeners();
        }
    }
    return ThreadWorkerDriver;
};
export default setupConstructor();
