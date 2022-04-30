const async = require('async'), Tuner = require('./tuner'), Events = require('events')

class AutoTuner extends Events {
    constructor(entries, opts, name, megaURL, mediaType, preferredStreamURL){
        super()
        this.name = name
        this.paused = false
        this.headless = false
        this.megaURL = megaURL
        this.mediaType = mediaType == 'audio' ? 'all' : mediaType // is we're searching a radio, no problem to return a radio studio webcam
        this.resultsBuffer = 2
        this.results = {}
        this.commitResults = {}
        this._intents = []
        this.succeededs = {} // -1 = bad mediatype, 0 = initialized, 1 = intenting, 2 = committed, 3 = starting failed
        if(!opts.allowedTypes || !Array.isArray(opts.allowedTypes)){
            opts.allowedTypes = []
            Object.keys(global.streamer.engines).forEach(n => {
                if(global.streamer.engines[n].mediaType == mediaType){
                    opts.allowedTypes.push(n)
                }
            })
        }
        this.opts = opts
        entries = this.ceilPreferredStreams(entries, this.preferredStreamServers(), preferredStreamURL)
        this.tuner = new Tuner(entries, opts, megaURL)
        this.tuner.on('success', (entry, nfo, n) => {
            if(typeof(this.succeededs[n]) == 'undefined' || ![0, 1, 2].includes(this.succeededs[n])){
                this.succeededs[n] = 0
            }
            if(Object.values(this.succeededs).filter(v => [0, 1].includes(v)).length >= this.resultsBuffer){
                this.tuner.pause()
            }
            if(!this.paused){
                this.pump()
            }
        })
        this.tuner.on('progress', stats => {
            this.stats = stats
            this.emit('progress', stats)
        })
        this.tuner.on('finish', () => {
            if(!this.paused){
                this.pump()
            }
        })
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
    ceilPreferredStreams(entries, preferredStreamServers, preferredStreamURL){
        let preferredStreamEntry
        const preferHLS = global.config.get('prefer-hls')
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
        return entries
    }
    pause(){
        if(this.opts.debug){
            console.log('autotuner PAUSE', traceback())
        }
        this.paused = true
        Object.keys(this.succeededs).forEach(n => {
            if(this.succeededs[n] == 1){
                this.succeededs[n] = 0
            }
        })
        if(!this.tuner.finished){
            this.tuner.pause()
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
                this.paused = false
                this.tuner.resume()
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
            let resolved
            this.emit('progress', this.tuner.getStats())
            const successListener = n => {
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
                                global.displayErr('TUNER COMMITING '+ ret +' - '+ n.data.url)
                            }
                            this.commitResults[n.nid] = ret
                            if(ret !== true) {
                                this.once('success', successListener)
                                this.succeededs[n.nid] = 0
                                return // don't resolve on commit error
                            }
                        }
                        resolve(n)
                    } else {
                        reject('cancelled by user') // maybe it's not a intent from the AutoTuner instance, but one else started by the user, resolve anyway
                    }
                }
            }
            this.once('success', successListener)
            this.once('finish', () => {
                if(this.opts.debug){
                    console.log('auto-tuner tune finish')
                }
                this.pause()
                if(!resolved){
                    resolved = true
                    reject('finished')
                }
            })
            this.resume()
            this.pump()
        })
    }
    prepareIntentToEmit(e){
        if(this.mediaType == 'live' && this.megaURL && this.name){
            e.data = Object.assign({
                originalUrl: this.megaURL,
                originalName: this.name
            }, e.data)            
        }
        return e
    }
    pump(){
        if(this.paused || this.destroyed || this.pumping){
            return
        }
        this.pumping = true
        let done, finished = this.tuner.finished, ks = Object.keys(this.succeededs), index = ks.filter(i => this.succeededs[i] == 0)
        if(index.length < this.resultsBuffer){
            if(!this.tuner.finished){
                this.tuner.resume()
            }
        }
        //index = index.concat(ks.filter(i => this.succeededs[i] == 2)) // already returned entries after to avoid return the same
        index = index.concat(ks.filter(i => this.succeededs[i] == 3)) // starting failed entries after, as last resort
        if(this.opts.debug){
            console.log('auto-tuner pump()', index)
        }
        if(index.length){
            let intents = index.map(n => {
                if(!this.tuner.info[n]){
                    console.error('INDEX NOT FOUND', index, this.succeededs, n, this.tuner.info)
                }
                let intent = new global.streamer.engines[this.tuner.info[n].type](this.tuner.entries[n], {}, this.tuner.info[n])
                if(this.mediaType && this.mediaType != 'all' && intent.mediaType != this.mediaType){
                    console.warn('bad mediaType, skipping', intent.data.url, intent.mediaType, this.mediaType)
                    this.succeededs[n] = -1
                    intent.destroy()
                    return false
                }
                this._intents.push(intent)
                intent.nid = n
                return intent
            }).filter(n => n)
            console.error('BEFORE DESTROYING OTHER INTENTS', intents, intents.map(n => n.data.url))
            async.eachOfLimit(intents, global.config.get('tune-concurrency'), (n, i, acb) => {
                if(this.paused || this.destroyed){
                    done = true
                    acb()
                } else if(done || n.destroyed){
                    acb()
                } else {
                    this.succeededs[n.nid] = 1
                    n.start().then(() => {
                        if(this.paused){
                            this.succeededs[n.nid] = 0
                            n.destroy()
                            return
                        }
                        this.pause()
                        done = true
                        this.results[n.nid] = [true, n.type]
                        this.succeededs[n.nid] = 2
                        this.emit('success', n)
                        console.error('DESTROYING OTHER INTENTS', n.nid, intents)
                        intents.filter(nt => nt && nt.nid != n.nid).forEach(nt => {
                            if(nt.committed){
                                console.error('DESTROYING COMMITTED INTENT?', nt, n, global.streamer.active, done)
                            } else {
                                console.error('DESTROYING INTENT OTHER', nt.nid)
                            }
                            this.succeededs[nt.nid] = 0
                            nt.destroy()
                        })
                        let offset = this._intents.indexOf(n)
                        if(offset != -1){
                            this._intents.splice(offset, 1)
                        }
                    }).catch(err => {
                        console.error('INTENT FAILED', err, n, traceback())
                        this.results[n.nid] = [false, String(err)]
                        this.succeededs[n.nid] = 3
                        delete this.succeededs[n.nid]
                        let offset = this._intents.indexOf(n)
                        if(offset != -1){
                            this._intents.splice(offset, 1)
                        }
                        n.destroy()
                        intents[i] = n = null
                    }).finally(acb)
                }
            }, () => {
                this.pumping = false
                if(!this.paused){
                    if(!done){
                        if(finished){
                            this.finished = true
                            this.emit('finish')
                        } else {
                            this.pump()
                        }
                    }
                    if(this.opts.debug){
                        console.log('auto-tuner pump() OK')
                    }
                }
            })
        } else {
            this.pumping = false
            if(finished && !this.pending()){
                if(this.opts.debug){
                    console.log('auto-tuner pump() finished')
                }
                this.finished = true
                this.emit('finish')
            }
            if(this.opts.debug){
				console.log('auto-tuner pump() OK')
            }
        }
    }
    log(){
        let ret = {}
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
            let state = v == 'success', error = state ? null : v
            if(this.results[i]){
                state = this.results[i][0]
                error = state ? this.results[i][1] : null
            }
            if(typeof(this.commitResults[i]) != 'undefined'){
                error = String(this.commitResults[i])
            }
            ret[i] = {
                url,
                source: e.source,
                type: this.tuner.info[i] ? this.tuner.info[i].type : null,
                state,
                error
            }
        })
        return ret
    }
    logText(){
        let ret = [], info = Object.values(this.log())
        ret.push(this.tuner.entries.length +' streams')
        ret = ret.concat(info.map(e => {
            return e.url +' => '+ (e.state ? 'success' : 'failed') + (e.error === null ? '' : ', '+ e.error)
        }))
        return ret.join("\r\n")
    }
    pending(){ // has "still loading" intents?
        return Object.values(this.succeededs).includes(1)
    }
    has(url){
        return this.tuner.entries.some(e => e.url == url)
    }
    destroy(){
        if(this.opts.debug){
            console.log('auto-tuner destroy')
        }
        this.paused = true
        this.destroyed = true
        this.emit('destroy')
        this._intents.forEach(n => n.destroy())                
        this._intents = []
        this.tuner.destroy()
        this.removeAllListeners()
    }
}

module.exports = AutoTuner
