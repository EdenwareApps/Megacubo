/* Worker to update lists in background */
const  Events = require('events'), path = require('path')

/*
function wrapAsBase64(file){
	// workaround, macos throws not found for local files when calling Worker
	// TODO: maybe file:// could have solved that too
	return 'data:application/x-javascript;base64,' + Buffer.from(fs.readFileSync(file)).toString('base64')
}
*/

const setupConstructor = () => {
	const workerData = {paths, APPDIR}
	if(typeof(global.lang) != 'undefined' && typeof(global.lang.getTexts) == 'function'){
		workerData.lang = global.lang.getTexts()
	} else {
		workerData.lang = {}
	}
	workerData.bytenode = true
	workerData.MANIFEST = global.MANIFEST
	class WorkerDriver extends Events {
		constructor(){
			super()
			this.iterator = 1
			this.err = null
			this.finished = false
			this.promises = {}
			this.instances = {}
			this.terminating = {}
		}
		proxy(file){
			const trace = '' // global.traceback()
			const instance = new Proxy(this, {
				get: (self, method) => {
					const trace = global.traceback()
					const terminating = ['destroy', 'terminate'].includes(method)
					if(terminating) {
						self.terminating[file] = true
					} else if(method in self) {
						return self[method]
					} else if(method == 'toJSON') {
						return () => JSON.stringify(null)
					}
					return (...args) => {
						return new Promise((resolve, reject) => {
							const debug = false
							if(self.finished){
								if(self.terminating[file]) {
									return resolve()
								}
								return reject('worker already exited '+ file +' '+ method)
							}
							const id = self.iterator
							self.iterator++
							self.promises[id] = {
								resolve: ret => {
									resolve(ret)
									delete self.promises[id]
									const pending = Object.values(self.promises).some(p => p.file == file)
									if(!pending && self.terminating && self.terminating[file]) { // after resolve
										delete self.instances[file]
										delete self.terminating[file]
									}									
									debug && global.osd.show(path.basename(file) +' '+ method +' OK', 'fas fas-circle-notch', 'mwrk-'+ id, 'normal')
								},
								reject: err => {									
									debug && global.osd.show(path.basename(file) +' '+ method +' '+ 	String(err), 'fas fas-circle-notch faclr-red', 'mwrk-'+ id, 'long')
									reject(err)
								},
								file,
								method
							}
							debug && global.osd.show(path.basename(file) +' '+ method, 'fas fas-circle-notch', 'mwrk-'+ id, 'long')
							try {
								self.worker.postMessage({method, id, file, args})
							} catch(e) {
								console.error({e, method, id, file, args, trace})
								debug && global.osd.show(path.basename(file) +' '+ method +' '+ 	String(err), 'fas fas-circle-notch faclr-red', 'mwrk-'+ id, 'long')
							}
						})
					}
				}
			})
			this.instances[file] = instance
			return instance
		}
		rejectAll(file, err){
			Object.keys(this.promises).forEach(id => {
				if(!file || this.promises[id].file == file) {
					const terminating = ['destroy', 'terminate'].includes(this.promises[id].method)
					if(terminating) {
						this.promises[id].resolve()
					} else {
						this.promises[id].reject(err)
					}
					delete this.promises[id]
				}
			})
		}
		load(file){
			if(this.worker){
				this.worker.postMessage({method: 'loadWorker', file})
				return this.proxy(file)
			} else {
				throw 'Worker already terminated: '+ file
			}
		}
		bindConfigChangeListener(){
			this.on('config-change', data => {
				//console.log('Config changed from worker driver', data)
				global.config.reload()
				setTimeout(() => global.config.reload(), 3000) // read again after some seconds, the config file may delay on writing
			})
			this.configChangeListener = () => {
				this.worker && this.worker.postMessage({method: 'configChange', id: 0})
			}
			global.config.on('change', this.configChangeListener)
		}
		terminate(){
			this.finished = true
			this.configChangeListener && global.config.removeListener('change', this.configChangeListener)
			if(this.worker){
				setTimeout(() => { // try to prevent closing due to bug in nwjs
					this.worker.terminate()
					this.worker = null
				}, 5000)
			}
			this.rejectAll(null, 'worker manually terminated')
			this.removeAllListeners()
			global.config.removeListener('change', this.configChangeListener)
		}
	}
	class ThreadWorkerDriver extends WorkerDriver {
		constructor(){
			super()
			this.Worker = require('worker_threads').Worker
			this.worker = new this.Worker(path.join(__dirname, 'worker.js'), {
				workerData, 
				stdout: true, 
				stderr: true
			})
			this.worker.on('error', err => {
				let serr = String(err)
				this.err = err
				console.error('error '+ err +' '+ serr +' '+ JSON.stringify(this.instances, null, 3), {err, serr})
				if(serr.match(new RegExp('(out of memory|out_of_memory)', 'i'))){
					this.finished = true
					let msg = 'Worker exited out of memory, fix the settings and restart the app.'
					global.osd.show(msg, 'fas fa-exclamation-triangle faclr-red', 'out-of-memory', 'long')
				}
				if(typeof(err.preventDefault) == 'function'){
					err.preventDefault()
				}
				global.crashlog.save('Worker error: ', err)
				this.rejectAll(null, 'worker exited out of memory')
			}, true, true)
			this.worker.on('exit', () => {
				this.finished = true
				this.worker = null
				console.warn('Worker exited', this.err)
				this.rejectAll(null, this.err || 'worker exited')
			})
			this.worker.on('message', ret => {
				if(ret.id !== 0){
					if(ret.id && typeof(this.promises[ret.id]) != 'undefined'){
						this.promises[ret.id][ret.type](ret.data)
						delete this.promises[ret.id]
					} else {
						console.warn('Callback repeated: '+ JSON.stringify(ret))
					}
				} else if(ret.type && ret.type == 'event') {
					let pos = ret.data.indexOf(':')
					if(pos != -1){
						let evtType = ret.data.substr(0, pos)
						let evtContent = ret.data.substr(pos + 1)
						if(evtContent.length){
							evtContent = global.parseJSON(evtContent)
						}
						this.emit(evtType, evtContent)
					} else {
						this.emit(ret.data)
					}
				}
			})
			this.bindConfigChangeListener()
		}
	}
	class DirectDriver extends Events {
		constructor(){
			super()
			this.err = null
			this.finished = false
			this.instances = {}
		}
		load(file){
			this.instances[file] = new (require(file))()
			return new Proxy(this, {
				get: (self, method) => {
					if(method in self && method != 'terminate') {
						return self[method]
					}
					return (...args) => {
						return new Promise((resolve, reject) => {
							if(this.finished){
								if(['destroy', 'terminate'].includes(method)) {
									return resolve()
								}
								return reject('worker exited '+ file +' '+ method)
							}
							if(!this.instances[file]){
								return reject('worker not loaded '+ file +' '+ method)
							}
							const prom = this.instances[file][method](...args)
							if(!prom || !prom.then){
								console.error('Method '+ method +' does not returns a promise')
								return
							}
							prom.then(resolve).catch(reject)
						})
					}
				}
			})
		}
		terminate(){
			console.error('destroyed a worker '+ global.traceback())
			this.finished = true
			Object.keys(this.instances).forEach(file => {
				this.instances[file] && this.instances[file].terminate && this.instances[file].terminate()
				delete this.instances[file]
			})
			this.removeAllListeners()
		}
	}
	return ThreadWorkerDriver
	// return DirectDriver // useful for debugging
}

module.exports = setupConstructor()
