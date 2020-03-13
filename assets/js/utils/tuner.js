
const Tuning = (() => {
    var self = {
        verbose: false, 
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
            var downlink = window.navigator.connection.downlink || 5, cpuLimit = cpuCount * 8
            var ret = Math.round(downlink / averageStreamingBandwidth())
            if(ret > cpuLimit){
                ret = cpuLimit
            }
            if(ret < 1){
                ret = 1
            } else if(ret > 3) {
                ret = 3
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
                self.instances = self.instances.filter((item) => {
                    return item !== undefined
                })
            }
        },
        destroyAll: () => {
            self.instances.forEach((inst, i) => {
                self.instances[i].destroy()
                delete self.instances[i]
            })
            self.instances = []
        }
    }
    return self
})()

class Tuner extends Events {
    constructor(entries, megaUrl, type){
        super()
        this.master = Tuning
        this.debug = debugAllow(false)
        this.id = megaUrl + ':' + type
        this.type = type
        this.originalUrl = megaUrl
        this.intents = []
        this.timers = {}
        this.errors = {}
        this.testMap = null
        this.entries = entries
        this.suspended = true
        this.resultBufferSize = 0
        this.scanState = 0 // 0=not started, 1=started, 2=internally suspended, 3=done
        this.finished = false
        this.destroyed = false
        this.active = 0
        this.actives = []
        this.status = 0
        this.types = this.master.types
        this.skipPlaybackTest = false
        this.sameDomainDelay = 3000
        if(typeof(this.types[this.type]) != 'undefined'){
            this.allowedTypes = this.types[this.type]
            if(this.type == 'live' && !Config.get('tuning-ignore-webpages')){
                this.allowedTypes.push('html')
            }
        } else if(!this.type || this.type == 'all') {
            this.allowedTypes = [].concat.apply([], Object.values(this.types))
            if(!Config.get('tuning-ignore-webpages')){
                this.allowedTypes.push('html')
            }
        } else {
            this.allowedTypes = [type]
        }
        this.concurrency = this.master.concurrency()
        this.master.register(this)
	}
    resume(){
        if(this.finished){
            this.rewind()
        }
        if(this.suspended || !this.active){
            this.suspended = false
            this.process()
            //setPriority('high priority')
        }
    }
	suspend(){
        if(!this.suspended){
            this.suspended = true
            this.emit('suspend')
            //setPriority('normal')
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
        // console.warn('PROCESS')
        if(this.processTimer){
            clearTimeout(this.processTimer)
        }
        if(!this.suspended && !this.finished){
            // emit results
            // console.warn('PROCESS')
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
                        this.emit('result', this.entries[i], this.typeMap[i])
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
            // console.warn('PROCESS')
            // finished?
            if(this.testMap.filter(t => { return t != 0 }).length == this.entries.length){
                this.scanState = 3
                if(!ret){
                    this.finish()   
                }
            }
            // console.warn('PROCESS')
            // should suspend?
            if(ret){
                console.warn('PROCESS')
                if(this.resultBufferSize != -1 && this.buffered() >= this.resultBufferSize){
                    this.suspend()
                }
            } else {
                console.warn('PROCESS')
                if(this.scanState == 3){
                    this.suspend()
                    this.emit('finish')
                }
            }
            // console.warn('PROCESS')
            // spawn new tests
            if(!this.suspended && !this.finished && this.active < this.concurrency){
                console.warn('PROCESS')
                this.scanState = 1
                var self = this
                let next = () => { // spawn by stream type priority
                    let success = false
                    this.allowedTypes.forEach(type => {
                        if(this.active < this.concurrency){
                            this.typeMap.forEach((t, i) => {
                                if(this.active < this.concurrency && typeof(this.testMap[i]) == 'undefined' && Array.isArray(t) && t.indexOf(type) != -1){
                                    let domain = getDomain(this.entries[i].url)
                                    if(typeof(this.sameDomainCtl[domain]) == 'undefined' || (typeof(this.sameDomainCtl[domain]) == 'number' && time() >= this.sameDomainCtl[domain])){
                                        console.warn('PROCESS', this.entries[i].url)
                                        this.sameDomainCtl[domain] = true
                                        this.test(i, () => {
                                            if(self.sameDomainCtl){
                                                self.sameDomainCtl[domain] = time() + (self.sameDomainDelay / 1000)
                                            }
                                        })
                                        success = true
                                        console.warn('PROCESS')
                                    }
                                }
                            })
                        }
                    })
                    return success
                }
                // fill the concurrency limit
                next()
                if(this.active < this.concurrency){
                    if(this.processTimer){
                        clearTimeout(this.processTimer)
                    }
                    this.processTimer = setTimeout(() => {
                        this.process()
                    }, this.sameDomainDelay)
                }
                console.warn('PROCESS')
            }
            // console.warn('PROCESS')
            // update progress
            this.progress()
            // console.warn('PROCESS')
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
        return (this.resultBufferSize != -1 && this.resultBufferSize && this.buffered() >= this.resultBufferSize)
    }
    test(i, tcb){
        let entry = this.entries[i], t = this.typeMap[i]
        this.testMap[i] = 0 // undefined to zero, the zero will act as a lock to pick once
        this.active++
        this.actives.push(entry)
        if(this.master.verbose){
            console.warn('TESTEST', entry.name, type)
        }
        Playback.createIntent(entry, {
            shadow: true, 
            manual: false,
            autorun: false
        }, t, (err, intents) => {
            if(this.finished){
                return
            }
            let types = [], errors = []
            this.intents[i] = intents
            async.eachOfLimit(intents, 1, (intent, k, ncb) => {
                if(this.finished){
                    if(typeof(ncb) == 'function'){
                        ncb()
                        ncb = null
                    }
                }
                let icb = (worked) => {                                                    
                    intent.destroy()
                    if(typeof(ncb) == 'function'){
                        ncb()
                        ncb = null
                    }                    
                }
                intent.on('start', () => {
                    if(this.skipPlaybackTest === true){
                        types.push(intent.type)
                        icb()
                    } else {
                        intent.test(worked => {
                            if(worked){
                                types.push(intent.type)
                            } else {
                                errors.push(intent.error || 'Test failed')
                            }
                            icb()
                        })
                    }
                })
                intent.on('error', () => {
                    errors.push(intent.error)
                    icb()
                })
                intent.on('end', () => {
                    icb()
                })
                if(this.skipPlaybackTest === true){
                    intent.tested = true
                }
                intent.run()
                intent.setTimeout(Config.get('tune-timeout') * 1.5) // extend timeout as tests are simultaneous
            }, () => {
                if(this.finished){
                    return
                }
                if(types && types.length){
                    this.testMap[i] = 1
                } else if(types === false) { // no compatible intents
                    this.testMap[i] = 3
                } else {
                    this.testMap[i] = -1
                    this.errors[i] = errors
                }
                this.active--
                let p = this.actives.indexOf(entry)
                if(p != -1){
                    delete this.actives[p]
                }
                this.process()
                if(typeof(tcb) == 'function'){
                    tcb()
                }
            })
        })
    }
    start(){
        if(this.testMap === null){
            this.scanState = 1
            this.testMap = []
            this.typeMap = []
            this.sameDomainCtl = {}
            this.resume()
            this.entries = this.entries.filter((e, i) => {
                return !isMegaURL(e.url)
            })
            this.entries.forEach((e, i) => {
                this.entries[i].i = i
            })
            async.eachOfLimit(this.entries, this.concurrency, (entry, i, acb) => {
                let process = () => {
                    if(this.finished){
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
                            if(this.master.verbose){
                                console.log('WAITIN1')
                            }
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
                        if(types){
                            let otypes = types
                            types = types.split(',').filter(value => {
                                return this.allowedTypes.includes(value)
                            })
                            this.typeMap[i] = types && types.length ? types : 0
                            if(!this.typeMap[i]){
                                this.testMap[i] = 3
                                this.errors[i] = 'No compatible intents '+JSON.stringify(otypes)
                            }
                        } else {
                            this.testMap[i] = -1
                            this.errors[i] = 'Seems offline '+JSON.stringify(types)
                        }
                        if(typeof(acb) == 'function'){
                            acb()
                            acb = null
                        }
                        this.process()
                    })
                }
                process()
            }, () => {
                this.process()
            })
        } else {
            this.resume()
        }
        this.progress()
    }
    progress(){  
        if(!this.destroyed){
            let complete = this.testMap.filter((state, i) => {
                return state != 0
            }).length
            if(complete != this.complete){
                this.complete = complete
                if(this.complete >= this.entries.length){
                    this.process()
                } else {
                    this.status = this.complete / (this.entries.length / 100)
                    this.emit('progress', this.status, this.complete, this.entries.length)
                }
            }
        }
    }
    rewind(){
        if(this.finished){
            this.testMap.forEach((state, i) => {
                switch(state){
                    case -2:
                        this.testMap[i] = -1
                        break
                    case 2:
                        this.testMap[i] = 1
                        return true
                        break
                    case -3:
                        this.testMap[i] = -3
                        break
                }
            })
            if(this.buffered()){
                this.finished = false
                this.process()
                return true
            }
        }
    }
    finish(){
        if(!this.finished){
            this.finished = true
            this.scanState = 3
            this.status = 100
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
