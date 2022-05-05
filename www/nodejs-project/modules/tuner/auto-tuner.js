const Tuner = require('./tuner'), Events = require('events')

class AutoTuner extends Events {
    constructor(entries, opts){
        super()
        this.paused = false
        this.headless = false
        this.minProgress = 0
        this.resultsBuffer = 2
        this.results = {}
        this.commitResults = {}
        this.intents = []
        this.succeededs = {} // -1 = bad mediatype, 0 = initialized, 1 = intenting, 2 = committed, 3 = starting failed
        opts.mediaType = opts.mediaType == 'audio' ? 'all' : opts.mediaType // is we're searching a radio, no problem to return a radio studio webcam
        if(!opts.allowedTypes || !Array.isArray(opts.allowedTypes)){
            opts.allowedTypes = []
            Object.keys(global.streamer.engines).forEach(n => {
                if(global.streamer.engines[n].mediaType == opts.mediaType){
                    opts.allowedTypes.push(n)
                }
            })
        }
        this.opts = opts
        this.entries = entries
        this.ffmpegBasedTypes = ['ts', 'rtmp', 'dash', 'aac']
    }
    async start(){
        if(!this.tuner){
            this.entries = await this.ceilPreferredStreams(this.entries, this.preferredStreamServers(), this.opts.preferredStreamURL)
            console.log('CEILED', this.entries.map(e => e.url))
            this.tuner = new Tuner(this.entries, this.opts, this.optsmegaURL)
            this.tuner.on('success', (e, nfo, n) => {
                if(typeof(this.succeededs[n]) == 'undefined'){
                    this.succeededs[n] = 0
                    if(!this.paused){
                        this.pump()
                    }
                }
            })
            this.tuner.on('progress', () => {
                this.emit('progress', this.getStats())
            })
            this.tuner.on('finish', () => {
                if(!this.paused){
                    this.pump()
                }
            })
            if(this.listenerCount('progress')){
                this.timer = setInterval(() => {
                    this.emit('progress', this.getStats())
                }, 1000)
            }
        }
    }
    ext(file){
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase()
    }
    preferredStreamServers(){
        return [...new Set(global.histo.get().map(e => e.preferredStreamURL || e.url).map(u => this.domain(u)))]
    }
	domain(u){
		if(u && u.indexOf('//') != -1){
			let d = u.split('//')[1].split('/')[0].split(':')[0]
			if(d == 'localhost' || d.indexOf('.') != -1){
				return d
			}
		}
		return ''
	}
    async ceilPreferredStreams(entries, preferredStreamServers, preferredStreamURL){
        let preferredStreamEntry
        const preferHLS = global.config.get('tuning-prefer-hls')
        const deferredStreams = [], deferredHLSStreams = []
        const preferredStreamServersLeveledEntries = {}
        entries = entries.forEach(entry => {
            if(entry.url == preferredStreamURL){
                preferredStreamEntry = entry
                return
            }
            if(preferredStreamServers.length){
                let i = preferredStreamServers.indexOf(this.domain(entry.url))
                if(i != -1){
                    if(typeof(preferredStreamServersLeveledEntries[i]) == 'undefined'){
                        preferredStreamServersLeveledEntries[i] = []
                    }
                    preferredStreamServersLeveledEntries[i].push(entry)
                    return
                }
            }
            if(preferHLS && this.ext(entry.url) == 'm3u8'){
                deferredHLSStreams.push(entry)
            } else {
                deferredStreams.push(entry)
            }
        })
        entries = []
        Object.keys(preferredStreamServersLeveledEntries).sort().forEach(k => {
            entries = entries.concat(preferredStreamServersLeveledEntries[k])
        })
        entries = entries.concat(deferredHLSStreams).concat(deferredStreams)
        if(preferredStreamEntry){
            entries.unshift(preferredStreamEntry)
        }
        return await global.watching.order(entries)
    }
    pause(){
        if(this.opts.debug){
            console.log('autotuner PAUSE', traceback())
        }
        this.paused = true
        if(!this.tuner.finished){
            this.tuner.pause()
        }
        if(this.timer){
            clearInterval(this.timer)
        }
    }
    resume(){
        if(!this.destroyed){
            if(this.opts.debug){
				console.log('autotuner RESUME', traceback())
            }
            this.paused = false
            if(this.tuner.finished){
                this.pump()
            } else {
                this.tuner.resume()
            }
            if(this.listenerCount('progress')){
                clearInterval(this.timer)
                this.timer = setInterval(() => {
                    this.emit('progress', this.getStats())
                }, 1000)
            }
            return true
        }
    }
    tune(){
        if(this.opts.debug){
            console.log('auto-tuner tune')
        }
        return new Promise((resolve, reject) => {
            if(this.destroyed){
                return reject('destroyed')
            }
            this.start().then(() => {
                let resolved
                this.emit('progress', this.getStats())
                const removeListeners = () => {
                    this.removeListener('success', successListener)
                    this.removeListener('finish', finishListener)
                }
                const successListener = n => {
                    removeListeners()
                    //console.log('auto-tuner tune commit', n)
                    this.pause()
                    if(resolved){
                        console.error('Tuner success after finish, verify it')
                    } else {
                        resolved = true
                        if(n.nid){
                            n = this.prepareIntentToEmit(n)
                            if(!this.headless){
                                let ret = global.streamer.commit(n)
                                if(global.debugTuning){
                                    global.displayErr('TUNER COMMITING '+ ret +' - '+ n.data.name)
                                }
                                this.commitResults[n.nid] = ret
                                if(ret !== true) {
                                    global.displayErr('TUNER COMMIT ERROR '+ ret +' - '+ n.data.name)
                                    this.once('success', successListener)
                                    this.succeededs[n.nid] = 3
                                    return // don't resolve on commit error
                                }
                            }
                            resolve(n)
                        } else {
                            reject('cancelled by user') // maybe it's not a intent from the AutoTuner instance, but one else started by the user, resolve anyway
                        }
                    }
                }
                const finishListener = () => {
                    removeListeners()
                    if(this.opts.debug){
                        console.log('auto-tuner tune finish')
                    }
                    this.pause()
                    if(!resolved){
                        resolved = true
                        reject('finished')
                    }
                }
                this.once('success', successListener)
                this.once('finish', finishListener)
                this.resume()
                this.pump()
            }).catch(reject)
        })
    }
    prepareIntentToEmit(e){
        if(this.opts.mediaType == 'live' && this.opts.megaURL && this.opts.name){
            e.data = Object.assign({
                originalUrl: this.opts.megaURL,
                originalName: this.opts.name
            }, e.data)
            if(this.opts.terms){
                e.data.terms = this.opts.terms
            }
        }
        return e
    }
    getStats(){
        let stats = this.tuner.getStats()
        let pending = Object.values(this.succeededs).filter(i => i == 0 || i == 1)
        stats.successes -= pending.length
		this.intents.filter(n => !n.destroyed).map(n => n.timeoutStatus() / 100).forEach(s => stats.successes += s)
        stats.processed = stats.successes + stats.failures
		stats.progress = parseInt(stats.processed / (stats.total / 100))
		if(stats.progress > 99){
			stats.progress = 99
		}
		return stats
    }
    getQueue(){
        const busyDomains = this.tuner.busyDomains()
        let slotCount = global.config.get('tune-concurrency')
        let ffmpegBasedSlotCount = global.config.get('tune-ffmpeg-concurrency')
        let ks = Object.keys(this.succeededs).filter(i => {
            return this.tuner.info[i]
        }), index = ks.filter(i => this.succeededs[i] == 0), processingIndex = ks.filter(i => this.succeededs[i] == 1)
        index = index.concat(ks.filter(i => this.succeededs[i] == 3)) // starting failed entries after, as last resort
        processingIndex.forEach(i => {
            slotCount--
            if(this.ffmpegBasedTypes.includes(this.tuner.info[i].type)){
                ffmpegBasedSlotCount--
            }
            busyDomains.push(this.tuner.domainAt(i))
        })
        console.log('slots', index, processingIndex)
        index = index.filter(nid => {
            if(slotCount <= 0){
                return
            }
            const domain = this.tuner.domainAt(nid)
            if(busyDomains.includes(domain)){
                return
            }
            return true
        })
        if(this.tuner.finished){
            if(!index.length && !processingIndex.length){
                this.finish()
                index.length = 0
            }
        } else {
            if(slotCount){
                this.tuner.paused && this.tuner.resume()
            } else {
                !this.tuner.paused && this.tuner.pause()
            }
        }
        return {index, busyDomains, slotCount, ffmpegBasedSlotCount}
    }
    pump(){
        if(this.paused || this.destroyed) {
            return
        }
        let {index, busyDomains, slotCount, ffmpegBasedSlotCount} = this.getQueue()
        index.forEach(nid => {
            if(slotCount <= 0){
                return
            }
            const domain = this.tuner.domainAt(nid)
            if(busyDomains.includes(domain)){
                return
            }
            const nidType = this.tuner.info[nid].type
            const nidFFmpeg = this.ffmpegBasedTypes.includes(nidType)
            if(nidFFmpeg){
                if(ffmpegBasedSlotCount <= 0){
                    return
                }
                if(!global.config.get('auto-testing')){
                    return
                }
            }    
            let intent = new global.streamer.engines[this.tuner.info[nid].type](this.tuner.entries[nid], {}, this.tuner.info[nid])
            if(this.opts.mediaType && this.opts.mediaType != 'all' && intent.mediaType != this.opts.mediaType){
                console.warn('bad mediaType, skipping', intent.data.url, intent.mediaType, this.opts.mediaType)
                this.succeededs[n] = -1
                intent.destroy()
                return
            }
            this.intents.push(intent)
            intent.nid = nid            
            slotCount--
            if(nidFFmpeg){
                ffmpegBasedSlotCount--
            }
            busyDomains.push(domain)
            this.succeededs[nid] = 1
            intent.on('destroy', () => {
                setTimeout(() => { // allow catch to process before
                    if(intent){
                        this.succeededs[nid] = 3
                        this.intents = this.intents.filter(n => n.nid != nid)
                        intent = null
                        this.pump()
                    }
                }, 400)
            })
            intent.start().then(() => {
                if(this.paused){
                    this.succeededs[nid] = 0
                    intent.destroy()
                    return
                }
                this.pause()
                this.results[nid] = [true, intent.type]
                this.succeededs[nid] = 2
                this.emit('success', intent)
                console.error('DESTROYING OTHER INTENTS', nid)
                this.intents.filter(nt => nt && nt.nid != nid).forEach(nt => {
                    if(nt.committed) {
                        global.displayErr('DESTROYING COMMITTED INTENT?')
                    } else if(nt.destroyed) {
                        global.displayErr('DESTROYING ALREADY DESTROYED INTENT?')
                    } else {
                        console.error('DESTROYING INTENT OTHER', nt.nid)
                    }
                    this.succeededs[nt.nid] = 0
                    nt.destroy()
                })
                this.intents = []
                intent = null
            }).catch(err => {
                if(intent){
                    if(this.succeededs[nid] != 0){ // not destroyed by other intent commit
                        console.error('INTENT FAILED', err, traceback())
                        this.results[nid] = [false, String(err)]
                        this.succeededs[nid] = 3
                    }
                    this.intents = this.intents.filter(n => n.nid != nid)
                    if(!intent.destroyed){
                        intent.destroy()
                    }
                    intent = null
                    this.pump()
                }
            })
        })
        if(!this.paused && !this.finished && !this.destroyed) {
            this.emit('progress', this.getStats())
        }
    }
    log(){
        let ret = {}
        if(this.tuner){
            this.tuner.entries.forEach((e, i) => {
                let v
                if(typeof(this.tuner.errors[i]) == 'undefined'){
                    v = 'undefined'
                } else {
                    if(this.tuner.errors[i] === 0) {
                        v = 'timeout'
                    } else if(this.tuner.errors[i] === -1) {
                        v = 'unreachable'
                    } else {
                        v = this.tuner.errors[i]
                    }
                }
                const url = e.url
                let state = v == 'success', info = state ? this.succeededs[i] : v
                if(this.results[i]){
                    state = this.results[i][0]
                    info = [this.succeededs[i], this.results[i][1]].join(' - ')
                }
                if(typeof(this.commitResults[i]) != 'undefined'){
                    info = String(this.commitResults[i])
                }
                ret[i] = {
                    name: e.name,
                    url,
                    source: e.source,
                    type: this.tuner.info[i] ? this.tuner.info[i].type : null,
                    state,
                    info
                }
            })
        }
        return ret
    }
    logText(){
        let ret = [], info = Object.values(this.log())
        ret.push(this.tuner.entries.length +' streams')
        ret = ret.concat(info.map(e => {
            return e.url +' => '+ (e.state ? 'success' : 'failed') + (e.info === null ? '' : ', '+ e.info)
        }))
        return ret.join("\r\n")
    }
    has(url){
        return this.tuner.entries.some(e => e.url == url)
    }
    finish(){
        this.finished = true
        this.emit('finish')
        this.timer && clearInterval(this.timer)
        this.intents.forEach(n => n.destroy())                
        this.intents = []
        this.destroy()
    }
    destroy(){
        if(this.opts.debug){
            console.log('auto-tuner destroy')
        }
        this.paused = true
        this.destroyed = true
        this.emit('destroy')
        this.intents.forEach(n => n.destroy())                
        this.intents = []
        this.tuner.destroy()
        this.removeAllListeners()
        this.timer && clearInterval(this.timer)
    }
}

module.exports = AutoTuner
