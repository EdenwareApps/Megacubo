const async = require('async'), Tuner = require('./tuner'), Events = require('events')

class AutoTuner extends Events {
    constructor(entries, opts, name, megaURL, mediaType){
        super()
        this.name = name
        this.paused = false
        this.headless = false
        this.megaURL = megaURL
        this.mediaType = mediaType
        this.resultsBuffer = 2
        this.intentConcurrency = 1
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
        this.tuner = new Tuner(entries, opts, megaURL)
        this.tuner.on('success', (entry, nfo, n) => {
            this.succeededs[n] = 0
            if(Object.keys(this.succeededs).length >= this.resultsBuffer){
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
    pause(){
        console.log('autotuner PAUSE', traceback())
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
            console.log('autotuner RESUME', traceback())
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
        console.log('auto-tuner tune')
        return new Promise((resolve, reject) => {
            let resolved
            this.emit('progress', this.tuner.getStats())
            this.once('success', n => {
                //console.log('auto-tuner tune commit', n)
                this.pause()
                if(!resolved){
                    resolved = true
                    if(n.nid){
                        n = this.prepareIntentToEmit(n)
                        if(!this.headless){
                            global.streamer.commit(n)
                        }
                        resolve(n)
                    } else {
                        reject('cancelled by user') // maybe it's not a intent from the AutoTuner instance, but one else started by the user, resolve anyway
                    }
                }
            })
            this.once('finish', () => {
                console.log('auto-tuner tune finish')
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
        if(this.mediaType == 'live'){
            e.data = Object.assign({
                originalUrl: this.megaURL,
                originalName: this.name
            }, e.data)            
        }
        return e
    }
    pump(){
        if(this.paused || this.destroyed){
            return
        }
        let done, finished = this.tuner.finished, ks = Object.keys(this.succeededs), index = ks.filter(i => this.succeededs[i] == 0)
        if(index.length < this.resultsBuffer){
            if(!this.tuner.finished){
                this.tuner.resume()
            }
        }
        //index = index.concat(ks.filter(i => this.succeededs[i] == 2)) // already returned entries after to avoid return the same
        index = index.concat(ks.filter(i => this.succeededs[i] == 3)) // starting failed entries after, as last resort
        console.log('auto-tuner pump()', index)
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
            async.eachOfLimit(intents, this.intentConcurrency, (n, i, acb) => {
                if(this.paused || this.destroyed){
                    done = true
                    acb()
                } else if(done){
                    acb()
                } else {
                    this.succeededs[n.nid] = 1
                    const url = n.data.url
                    n.start().then(() => {
                        if(this.paused){
                            this.succeededs[nt.nid] = 0
                            n.destroy()
                            return
                        }
                        this.pause()
                        done = true
                        this.succeededs[n.nid] = 2
                        this.emit('success', n)
                        intents.filter(nt => nt.nid != n.nid).forEach(nt => {
                            if(nt.committed){
                                console.error('DESTROYING COMMITTED INTENT?', nt, n, global.streamer.active, done)
                            }
                            this.succeededs[nt.nid] = 0
                            nt.destroy()
                        })
                        let offset = this._intents.indexOf(n)
                        if(offset != -1){
                            this._intents.splice(offset, 1)
                        }
                    }).catch(err => {
                        this.succeededs[n.nid] = 3
                        delete this.succeededs[n.nid]
                        intents[n] = n = null
                    }).finally(acb)
                }
            }, () => {
                if(!this.paused){
                    if(!done){
                        if(finished){
                            this.finished = true
                            this.emit('finish')
                        } else {
                            this.pump()
                        }
                    }
                    console.log('auto-tuner pump() OK')
                }
            })
        } else {
            if(finished && !this.pending()){
                console.log('auto-tuner pump() finished')
                this.finished = true
                this.emit('finish')
            }
            console.log('auto-tuner pump() OK')
        }
    }
    pending(){ // has "still loading" intents?
        return Object.values(this.succeededs).includes(1)
    }
    has(url){
        return this.tuner.entries.some(e => e.url == url)
    }
    destroy(){
        console.log('auto-tuner destroy')
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
