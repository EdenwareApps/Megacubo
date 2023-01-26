const fs = require('fs'), Events = require('events')

function prepare(file){ // workaround, macos throws not found for local files when calling Worker
	return 'data:application/x-javascript;base64,' + Buffer.from(fs.readFileSync(file)).toString('base64')
}

module.exports = (file, opts) => {
	const skipWorkerThreads = ((opts && opts.skipWorkerThreads) || (!global.cordova && typeof(Worker) != 'undefined')), workerData = {file, paths, APPDIR}
	if(typeof(global.lang) != 'undefined'){
		workerData.lang = global.lang.getTexts()
	}
	if(opts && opts.bytenode){
		workerData.bytenode = true
	}
	workerData.MANIFEST = global.MANIFEST
	class WorkerDriver extends Events {
		constructor(){
			super()
			this.err = null
			this.finished = false
			this.promises = {}
		}
		proxy(){
			return new Proxy(this, {
				get: (self, method) => {
					if(method in self){
						return self[method]
					}
					return (...args) => {
						return new Promise((resolve, reject) => {
							if(this.finished){
								return reject('worker exited')
							}
							let id
							for(id = 1; typeof(self.promises[id]) != 'undefined'; id++);
							self.promises[id] = {resolve, reject}
							try {
								self.worker.postMessage({method, id, args})
							} catch(e) {
								console.error(e, {method, id, args})
							}
						})
					}
				}
			})
		}
		bindConfigChangeListener(){
			this.on('config-change', data => {
				//console.log('Config changed from worker driver', data)
				global.config.reload()
				setTimeout(() => {
					global.config.reload() // read again after some seconds, the config file may delay on writing
				}, 3000)
			})
			this.configChangeListener = () => {
				//console.log('CONFIG CHANGED!')
				this.worker.postMessage({method: 'configChange', id: 0})
			}
			global.config.on('change', this.configChangeListener)
		}
		terminate(){
			this.finished = true
			this.configChangeListener && global.config.removeListener('change', this.configChangeListener)
			if(this.worker){
				//this.worker.postMessage({method: 'unload', id: 0})
				setTimeout(() => { // prevent closing by bug in nwjs
					this.worker.terminate()
					this.worker = null
				}, 5000)
			}
			this.removeAllListeners()
		}
	}
	class ThreadWorkerDriver extends WorkerDriver {
		constructor(){
			super()
			this.Worker = require('worker_threads').Worker
			this.worker = new this.Worker(global.APPDIR + '/modules/driver/worker.js', {
				workerData, 
				stdout: true, 
				stderr: true,
				resourceLimits: {
					maxOldGenerationSizeMb: 2048,
					maxYoungGenerationSizeMb: 2048
				}
			})
			this.worker.on('error', err => {
				let serr = String(err)
				this.err = err
				console.error('error ' + file, err, serr)
				if(serr.match(new RegExp('(out of memory|out_of_memory)', 'i'))){
					let msg = 'Worker '+ file.split('/').pop() +' exitted out of memory, fix the settings and restart the app.'
					global.osd.show(msg, 'fas fa-exclamation-triagle faclr-red', 'out-of-memory', 'persistent')
				}
				if(typeof(err.preventDefault) == 'function'){
					err.preventDefault()
				}
				global.crashlog.save('Worker error at '+ file.split('/').pop() +': ', err)
			}, true, true)
			this.worker.on('exit', () => {
				this.finished = true
				this.worker = null
				console.warn('Worker exit. ' + file, this.err)
			})
			this.worker.on('message', ret => {
				if(ret.id !== 0){
					if(ret.id && typeof(this.promises[ret.id]) != 'undefined'){
						this.promises[ret.id][ret.type](ret.data)
						delete this.promises[ret.id]
					} else {
						console.error('Worker error', ret)
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
			return this.proxy()
		}
	}
	class WebWorkerDriver extends WorkerDriver {
		constructor(){
			super()
			this.worker = new Worker(prepare(global.APPDIR + '/modules/driver/web-worker.js'), {
				name: JSON.stringify(workerData)
			})
			this.worker.onerror = err => {  
				let serr = String(err)
				this.err = err
				console.error('error ' + file, err, serr)
				if(serr.match(new RegExp('(out of memory|out_of_memory)', 'i'))){
					let msg = 'Webworker ' + file.split('/').pop() + ' exitted out of memory, fix the settings and restart the app.'
					global.osd.show(msg, 'fas fa-exclamation-triagle faclr-red', 'out-of-memory', 'persistent')
				}
				if(typeof(err.preventDefault) == 'function'){
					err.preventDefault()
				}
				global.crashlog.save('Worker error at '+ file.split('/').pop() +': ', err)
				return true
			}
			this.worker.onmessage = e => {
				const ret = e.data
				if(ret.id !== 0){
					if(ret.id && typeof(this.promises[ret.id]) != 'undefined'){
						this.promises[ret.id][ret.type](ret.data)
						delete this.promises[ret.id]
					} else {
						console.error('Worker error', ret)
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
			}
			this.bindConfigChangeListener()
			return this.proxy()
		}
	}
	function hasWorkerThreads(){				
		try {
			if(require.resolve('worker_threads')){
				require('worker_threads')
				return true
			}
		} catch(e) { }		
	}
	if(skipWorkerThreads === true || !hasWorkerThreads()){
		if(typeof(Worker) != 'undefined'){
			return WebWorkerDriver
		} else {
			console.error('Driver loading inline, bad for performance: '+ file)
			process.exit(1)
		}
	} else {
		return ThreadWorkerDriver
	}
}
