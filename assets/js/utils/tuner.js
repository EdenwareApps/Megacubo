
const Tuning = (() => {
    var self = {
        instances: [],
        types: {
            'live': ['hls', 'ts', 'rtp'],
            'video': ['mp4'],
            'extra': ['html']
        },
        register: (tunerInstance) => {
            self.instances.push(tunerInstance)
        },
        is: (filter) => {
            let is = self.instances
            if(typeof(filter) == 'function'){
                is = is.filter(filter)
            }
            return is.some(i => {
                return !i.suspended && !i.finished
            })
        },
        concurrency(){
            var downlink = window.navigator.connection.downlink || 5, cpuLimit = cpuCount * 2
            var ret = Math.round(downlink / averageStreamingBandwidth())
            if(ret > cpuLimit){
                ret = cpuLimit
            }
            if(ret < 3){
                ret = 3
            } else if(ret > 8) {
                ret = 8
            }
            return ret
        },
        get: (megaUrl, id) => {
            let ret = false
            self.instances.some(inst => {
                if(inst.id == megaUrl || inst.id == megaUrl + ':' + id){
                    ret = inst
                    return true
                }
            })
            return ret
        },
        active: () => {
            let actives = self.instances.map(inst => {
                return inst.active
            })
            return actives.reduce((p, a) => p + a, 0)
        },
        status: () => {
            let statuses = self.instances.map(inst => {
                return inst.status
            })
            return statuses.reduce((p, a) => p + a, 0) / statuses.length
        },
        stop: (filter) => {
            let is = self.instances
            if(typeof(filter) == 'function'){
                is = is.filter(filter)
            }
            is.forEach(i => {
                i.suspend()
            })
        },
        destroy: (megaUrl, id) => {
            let rem
            self.instances.forEach((inst, i) => {
                if(self.instances[i].id == megaUrl || self.instances[i].id == megaUrl+':'+id){
                    self.instances[i].destroy()
                    delete self.instances[i]
                    rem = true
                }
            })
            if(rem){
                self.instances = self.instances.filter(function (item) {
                    return item !== undefined
                })
            }
        }
    }
    return self
})()

class Tuner extends Events {
    constructor(entries, megaUrl, type){
        super()
        this.debug = debugAllow(true)
        this.id = megaUrl + ':' + type
        this.type = type
        this.originalUrl = megaUrl
        this.sleeps = []
        this.intents = []
        this.timers = {}
        this.errors = {}
        this.testMap = null
        this.testMapTypes = []
        this.entries = entries
        this.suspended = true
        this.resultBufferSize = 1
        this.scanState = 0 // 0=not started, 1=started, 2=internally suspended, 3=done
        this.finished = false
        this.destroyed = false
        this.active = 0
        this.actives = []
        this.status = 0
        this.sameDomainDelay = 1500
        this.types = Tuning.types
        if(typeof(this.types[this.type]) != 'undefined'){
            this.allowedTypes = this.types[this.type]
        } else if(!this.type || this.type == 'all') {
            this.allowedTypes = [].concat.apply([], Object.values(this.types))
        } else {
            this.allowedTypes = [type]
        }
        this.concurrency = Tuning.concurrency()
        Tuning.register(this)
	}
    resume(){
        if(this.suspended || !this.active){
            this.suspended = false
            this.process()
            setPriority('high priority')
            if(this.resultBufferSize == -1 || this.buffered() < this.resultBufferSize){
                let i = this.concurrency - this.active
                while(i){
                    let args = this.sleeps.shift()
                    if(Array.isArray(args)){
                        if(this.scanState == 2){
                            this.scanState = 1
                        }
                        this.task.apply(this, args)
                        i--
                    } else {
                        break
                    }
                }
            }
        }
    }
	suspend(){
        if(!this.suspended){
            this.suspended = true
            this.emit('suspend')
            setPriority('normal')
        }
    }
    buffered(){
        let n = 0
        this.testMap.forEach((state, i) => {
            if(state == 1){
                n++
            }
        })
        return n
    }
    process(){
        if(!this.suspended && !this.destroyed){
            let ret = this.testMap.some((state, i) => {
                switch(state){
                    case -1:
                        this.emit('failure', this.entries[i], this.errors[i])
                        this.testMap[i] = -2
                        break
                    case 1:
                        if(this.debug){
                            console.warn('ACBR RESULT', this.entries[i], i, this.suspended, traceback())
                        }
                        if(isMegaURL(this.originalUrl)){
                            this.entries[i].originalUrl = this.originalUrl
                        }
                        this.emit('result', this.entries[i], this.testMapTypes[i])
                        this.testMap[i] = 2
                        return true
                        break
                    case 3:
                        this.emit('skip', this.entries[i])
                        this.testMap[i] = -3
                        break
                }
                return false
            })
            let complete = this.testMap.filter((state, i) => {
                return state != 0
            }).length
            if(complete != this.complete){
                this.complete = complete
                this.progress()
            }
            if(this.testMap.filter(t => { return t != 0 }).length == this.entries.length){
                this.finish()
            }
            if(ret){
                if(this.resultBufferSize != -1 && this.buffered() < this.resultBufferSize){
                    this.suspend()
                }
            } else {
                switch(this.scanState){
                    case 2:
                        // kkk
                        break
                    case 3:
                        this.suspend()
                        this.emit('finish')
                        break
                }
            }
        }
    }
    next(cb){
        let icb = (entry, types) => {
            if(Array.isArray(types)){
                cb(entry, types)
            } else {
                cb(false)
            }
            this.removeListener('result', icb)
            this.removeListener('finish', fcb)
        }, fcb = () => {
            let restart = this.testMap.some((state, i) => {
                return state == 2
            })
            if(restart){
                this.scanState = 1
                this.complete = 0
                this.testMap.forEach((state, i) => {
                    switch(state){
                        case 2:
                            this.testMap[i] = 1
                            return true
                            break
                    }
                })
                this.resume()
                this.process()
            } else {
                icb(false, false)
            }
        }
        this.on('result', icb)
        this.on('finish', fcb)
        this.resume()
    }
    shouldSuspend(){
        return (this.resultBufferSize != -1 && this.buffered() >= this.resultBufferSize)
    }
    start(){
        if(this.testMap === null){
            this.scanState = 1
            this.testMap = []
            this.typeMap = []
            this.resume()
            async.eachOfLimit(this.entries, 1, (entry, i, acb) => {
                let process = () => {
                    if(this.finished){
                        if(typeof(acb) == 'function'){
                            acb()
                            acb = null
                        }
                        return
                    }
                    if(isMegaURL(entry.url)) { // no compatible intents
                        this.typeMap[i] = 0
                        if(typeof(acb) == 'function'){
                            acb()
                            acb = null
                        }
                        return
                    }
                    if(this.shouldSuspend()){
                        let n = 'a'
                        if(typeof(this.timers[n]) != 'undefined'){
                            clearTimeout(this.timers[n])
                        }
                        this.timers[n] = setTimeout(() => {
                            console.log('WAITIN1')
                            process()
                        }, 1000)
                        return 
                    }                        
                    Playback.getIntentTypes(entry, null, (types) => {
                        if(this.finished){
                            if(typeof(acb) == 'function'){
                                acb()
                                acb = null
                            }
                            return
                        }
                        types = types.split(',').filter(value => {
                            return this.allowedTypes.includes(value)
                        })
                        this.typeMap[i] = types && types.length ? types : 0
                        if(!this.typeMap[i]){
                            this.testMap[i] = 3
                            this.testMapTypes[i] = []
                        }
                        if(typeof(acb) == 'function'){
                            acb()
                            acb = null
                        }
                    })
                }
                process()
            }, () => {
                this.process()
            })
            async.eachOfLimit(this.entries, this.concurrency, (entry, k, bcb) => {
                let process = () => {
                    if(this.finished){
                        if(typeof(bcb) == 'function'){
                            bcb()
                            bcb = null
                        }
                        return
                    }
                    let ret, done = this.typeMap.length == this.entries.length
                    if(this.shouldSuspend()){
                        this.scanState = 2
                    } else {
                        this.scanState = 1
                        ret = this.allowedTypes.some(type => {
                            return this.typeMap.some((t, i) => {
                                if(Array.isArray(t)){
                                    done = false
                                    if(t.indexOf(type) != -1){
                                        let t = this.typeMap[i]
                                        this.typeMap[i] = 0 // no problem overriding here, we don't need this info and the zero will act as a lock to pick once
                                        entry = this.entries[i]
                                        this.active++
                                        this.actives.push(entry)
                                        Playback.createIntent(entry, {
                                            shadow: true, 
                                            manual: false,
                                            autorun: false
                                        }, t, (err, intents) => {
                                            if(this.finished){
                                                if(typeof(bcb) == 'function'){
                                                    bcb()
                                                    bcb = null
                                                }
                                                return
                                            }
                                            let types = [], errors = []
                                            this.intents[i] = intents
                                            async.eachOfLimit(intents, 1, (intent, k, ncb) => {
                                                if(this.finished){
                                                    return ncb()
                                                }
                                                let icb = (worked) => {                                                    
                                                    intent.destroy()
                                                    if(typeof(ncb) == 'function'){
                                                        ncb()
                                                        ncb = null
                                                    }                    
                                                }
                                                intent.on('start', () => {
                                                    types.push(intent.type)
                                                    icb()
                                                })
                                                intent.on('error', () => {
                                                    errors.push(intent.error)
                                                    icb()
                                                })
                                                intent.on('end', () => {
                                                    icb()
                                                })
                                                intent.run()
                                            }, () => {
                                                if(types && types.length){
                                                    this.testMap[i] = 1
                                                    this.testMapTypes[i] = types
                                                } else if(types === false) { // no compatible intents
                                                    this.testMap[i] = 3
                                                    this.testMapTypes[i] = []
                                                } else {
                                                    this.testMap[i] = -1
                                                    this.errors[i] = errors
                                                }
                                                this.active--
                                                let p = this.actives.indexOf(entry)
                                                if(p != -1){
                                                    delete this.actives[p]
                                                }
                                                if(typeof(bcb) == 'function'){
                                                    bcb()
                                                    bcb = null
                                                }
                                                //console.log('SOLVED', k)
                                                this.process()
                                                //console.log('SOLVED', k)
                                            })
                                        })
                                        return true
                                    }
                                }
                            })
                        })
                    }
                    if(!ret){
                        //console.log('WAITING', k)
                        if(done){
                            if(typeof(bcb) == 'function'){
                                bcb()
                                bcb = null
                            }
                            return
                        } else {
                            let n = 'b'
                            if(typeof(this.timers[n]) != 'undefined'){
                                clearTimeout(this.timers[n])
                            }
                            this.timers[n] = setTimeout(() => {
                                process()
                            }, 1000)
                        }
                    }
                }
                process()
            }, () => {
                this.finish()
            })
        } else {
            this.resume()
        }
        this.progress()
    }
    progress(){  
        if(!this.destroyed){
            this.status = this.complete / (this.entries.length / 100)
            this.emit('progress', this.status, this.complete, this.entries.length)
        }
    }
    finish(){
        if(!this.finished){
            this.finished = true
            this.scanState = 3
            this.status = 100
            this.sleeps = []
            this.active = 0
            this.process()
            if(Array.isArray(this.intents)){
                this.intents.forEach(nts => {
                    nts.forEach(n => {
                        n.destroy()
                    })
                })
            }
        }
	}
	destroy(){
        if(!this.destroyed){
            this.destroyed = true
            this.suspend()
            Object.keys(this.timers).forEach(k => {
                clearTimeout(this.timers[k])
            })
            this.removeAllListeners()
            this.emit = () => {}
            this.finish()
            let keeps = []
            Object.keys(this).forEach(k => {
                if(keeps.indexOf(k) == -1){
                    if(typeof(this[k]) == 'object'){
                        this[k] = null
                    } else if(typeof(this[k]) == 'function'){
                        this[k] = () => {}
                    }
                }
            })
        }
	}
}
