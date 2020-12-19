const path = require('path'), Events = require('events'), async = require('async')
    
class TunerUtils extends Events {
    constructor(entries, opts, name){
        super()
        this.paused = true
        this.opts = {
			debug: false,
			shadow: false,
			allowedTypes: null
		}
		this.name = name ? global.ucWords(name) : (entries.length ? entries[0].name : '')
        if(opts){
            this.setOpts(opts)
		}
	}
    setOpts(opts){
        if(opts && typeof(opts) == 'object'){     
			Object.keys(opts).forEach((k) => {
				if(['debug'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
					this.on(k, opts[k])
				} else {
					this.opts[k] = opts[k]
				}
            })
        }
	}
	host(u){
		if(u && u.indexOf('//') != -1){
			let d = u.split('//')[1].split('/')[0]
			if(d.substr(-3) == ':80'){
				d = d.substr(0, d.length - 3)
			}
			if(d == 'localhost' || d.indexOf('.') != -1){
				return d
			}
		}
		return ''
	}
	time(){
		return ((new Date()).getTime() / 1000)
	}
}

class TunerTask extends TunerUtils {
	constructor(entries, opts, name){
		super(entries, opts, name)
		this.info = []
		this.results = []
		this.domains = []
		this.errors = []
		this.states = []
        this.domainDelay = {}		
	}
	test(e, i){
		if(this.opts.debug){
			this.opts.debug('Tuner')
		}
		return new Promise((resolve, reject) => {   
			if(this.opts.debug){
				this.opts.debug('Tuner')
			}
			this.states[i] = 1 
			if(!this.streamer){
				this.streamer = new (require(path.resolve(__dirname, '../streamer')))({shadow: true})
			}
			/*
			STATES, used by test()
			-2 = start failed
			-1 = probe failed
			0 = uninitialized
			1 = probing
			2 = probed, starting
			3 = success, ready

			RESULT STATES .results[], used by task() and pump()
			-2 = failure, emitted
			-1 = failure, queued
			0 = uninitialized
			1 = success, queued
			2 = success, emitted
			*/
			this.streamer.info(e.url).then(info => {
				if(!this.aborted){
					console.warn('TEST SUCCESS', e, info, this.opts.allowedTypes)
					if(info.type == 'hls' && String(info.sample).toLowerCase().indexOf('endlist') != -1){
						info.type = 'video' // dirty hack to bypass vod hls when searching for live
					}
					if(!Array.isArray(this.opts.allowedTypes) || this.opts.allowedTypes.includes(info.type)){
						this.info[i] = info
						this.states[i] = 2
						resolve(e)
					} else {
						let err = 'Tuner bad intent type: ' + info.type
						this.states[i] = -1
						if(this.opts.debug){
							this.opts.debug(err, i)
						}
						reject(err)
					}
				}
			}).catch(err => {   
				if(!this.aborted){
					console.warn('TEST FAILURE', e, err)   
					this.states[i] = -1       
					if(this.opts.debug){
						this.opts.debug('Tuner', err, i)
					}
				}
				reject(err)
			})			
		})
	}
	domainAt(i){
		if(typeof(this.domains[i]) == 'undefined'){
			this.domains[i] = this.host(this.entries[i].url)
		}
		return this.domains[i]
	}
	busyDomains(){
		let busy = []
		this.states.forEach((v, i) => {
			if(v == 1){
				let d = this.domainAt(i)
				if(!busy.includes(d)){
					busy.push(d)
				}
			}
		})
		return busy
	}
	nextEntry(){
		let ret = -1, retryAfter = -1, busy = this.busyDomains()
		this.entries.some((e, i) => {
			if(typeof(this.results[i]) == 'undefined'){
				if(!busy.length || !busy.includes(this.domainAt(i))){
					ret = i
					return true
				} else if(retryAfter == -1) {
					retryAfter = 3
				}
			}
		})
		return {i: ret, retryAfter}
	}
	task(cb){
		if(this.opts.debug){
			this.opts.debug('TUNER TASK', this.paused)
		}
        if(this.paused){
            this.once('resume', () => {
                this.task(cb)
            })
        } else {
            let data = this.nextEntry()
			if(this.opts.debug){
				this.opts.debug('TUNER nextEntry', data)
			}
            if(data.i != -1){
                let e = this.entries[data.i]
                this.results[data.i] = 0
                this.states[data.i] = 0
				if(this.opts.debug){
					this.opts.debug('Tuner pre', data.i)
				}
                this.test(e, data.i).then(ret => {
					if(this.opts.debug){
						this.opts.debug('Tuner suc', data.i, ret)
					}
					this.errors[data.i] = 'success'	
					this.results[data.i] = 1
					if(this.opts.debug){
						this.opts.debug('Tuner suc', data.i)	
					}
				    try {
						this.pump()
					} catch(e) {
						console.error(e)	
					}
					if(this.opts.debug){
						this.opts.debug('Tuner', data.i)
					}
                    cb()	
					if(this.opts.debug){
						this.opts.debug('Tuner suc', data.i)
					}
                }).catch(err => {		
					console.error('Tuner failure', err, e.url)
                    this.errors[data.i] = err
					this.results[data.i] = -1
					if(this.opts.debug){
						this.opts.debug('Tuner fail', data.i)
					}
                    cb()
					if(this.opts.debug){
						this.opts.debug('Tuner fail', data.i)
					}
				    this.pump()	
					if(this.opts.debug){
						this.opts.debug('Tuner fail', data.i)
					}
                })
            } else if(data.retryAfter != -1) {
                setTimeout(() => {
					if(this.opts.debug){
						this.opts.debug('Tuner retry', data.retryAfter)
					}
                    this.task(cb)
                }, data.retryAfter * 1000)
            } else {
				if(this.opts.debug){
					this.opts.debug('Tuner end')
				}
                cb()
                this.finish()
            }
        }
	}
	pause(){
		if(!this.paused){
			console.log('tuner paused', global.traceback())
			this.paused = true
			this.emit('pause')
		}
	}
	resume(){
		if(this.paused){
			console.log('tuner resume', global.traceback())
			this.aborted = false
			this.paused = false
			if(this.finished){
				/*
				this.results.forEach((state, i) => {
					if(this.results[i] == -2){
						this.results[i] = -1
					} else if(this.results[i] == 2){
						this.results[i] = 1
					}
				})
				*/
				this.intents = []
				this.results = []
				this.states = []
				this.started = false
				this.finished = false
				this.start()
			} else {
				if(this.started){
					this.emit('resume')
				} else {
					this.start()
				}
			}
			this.stats()
		}
	}
	active(){
		return !this.paused && !this.finished
	}
	abort(){
		console.log('tuner abort', traceback())
		if(!this.aborted){
			this.aborted = true
			if(!this.destroyed && !this.finished){
				this.emit('abort')
			}
			this.finish()
		}
	}
	finish(){
		if(!this.finished){
			if(!this.aborted && !this.destroyed){
				this.pump()
			}
			this.pause()
			this.finished = true
			if(!this.aborted && !this.destroyed){
				this.emit('finish')
			}
		}
	}
	destroy(){
		if(!this.destroyed){
			this.destroyed = true
			this.emit('destroy')
			this.abort()
			this.removeAllListeners()
			this.intents = []
			this.results = []
			this.states = []
		}
	}
}

class Tuner extends TunerTask {
    constructor(entries, opts, name){
        super(entries, opts, name)
        this.entries = entries
		this.started = false
		this.on('resume', this.pump.bind(this))
    }
	start(){
        if(!this.started){
			this.paused = false
			this.started = true
			if(this.opts.debug){
				this.opts.debug('TUNER STARTED')
			}
			this.stats()
			async.parallelLimit(new Array(this.entries.length).fill(this.task.bind(this)), global.config.get('tuning-concurrency'), () => {
				if(this.opts.debug){
					this.opts.debug('TUNER FINISHED')
				}
				this.finish()
			})
		}
	}
	getStats(){
		let stats = {
			failures: 0,
			successes: 0,
			total: this.entries.length
		}
		this.results.forEach((v, i) => {
			switch(v){
				case -1:
				case -2:
					stats.failures++
					break
				case 1:
				case 2:
					stats.successes++
					return true
					break
			}
		})
		stats.processed = stats.successes + stats.failures
		stats.progress = parseInt(stats.processed / (stats.total / 100))
		if(stats.progress > 99){
			stats.progress = 99
		}
		return stats
	}
	stats(){
		if(this.listenerCount('progress') > 0 && this.active()){
			this.emit('progress', this.getStats())
		}
	}
	pump(){
		if(this.active()){
			let changed, speed = 0, succeed = -1
			this.results.forEach((v, i) => {
				switch(v){
					case -1:
						this.results[i] = -2
						this.emit('failure', this.entries[i])
						if(!changed){
							changed = true
						}
						break
					case 1:
						if(succeed == -1 || speed < this.info[i].speed){
							speed = this.info[i].speed
							succeed = i
						}
						break
				}
			})
			if(succeed >= 0){
				this.results[succeed] = 2
				this.emit('success', this.entries[succeed], this.info[succeed], succeed)
				if(!changed){
					changed = true
				}
			}
			if(changed){
				this.stats()
			}
		}
		if(this.paused){
			return true
		}
	}
}

module.exports = Tuner
