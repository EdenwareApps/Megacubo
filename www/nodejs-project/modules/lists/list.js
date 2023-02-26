const Events = require('events'), ListIndex = require('./list-index'), ConnRacing = require('../conn-racing')

class List extends Events {
	constructor(url, parent, relevantKeywords){
		super(url, parent)
		this.debug = false
		if(url.substr(0, 2) == '//'){
			url = 'http:'+ url
		}
        this.url = url
        this.relevance = {}
        this.reset()
		this.dataKey = global.LIST_DATA_KEY_MASK.format(url)
        this.file = global.storage.raw.resolve(this.dataKey)
        this.constants = {BREAK: -1}
		this._log = [
			this.url
		]
        this.relevantKeywords = relevantKeywords || []
		this.parent = (() => parent)
	}
	log(...args){
		if(this.destroyed) return
		args.unshift(Date.now() / 1000)
		this._log.push(args)
	}
	async ready(){
		return new Promise((resolve, reject) => {
            if(this.isReady){
                resolve()
            } else {
                this.once('ready', resolve)
            }
        })
	}
	start(){
		return new Promise((resolve, reject) => {
            if(this.started){
                return resolve(true)
            }
            let resolved, destroyListener = () => {
                if(!resolved){
                    reject('destroyed')
                }
            }, cleanup = () => {
                this.removeListener('destroy', destroyListener)  
                if(!this.isReady) this.isReady = true  
            }
            this.once('destroy', destroyListener)
            this.indexer = new ListIndex(this.file, this.url)
            this.indexer.on('error', err => {
                reject(err)
                cleanup()
                this.emit('ready')
            })
            this.indexer.on('data', index => {
                if(index.length){
                    this.setIndex(index, err => {
                        resolved = true
                        if(err){
                            reject(err)
                        } else {
                            this.started = true
                            resolve(true)
                        }
                        cleanup()
                        this.emit('ready')
                    })
                } else {
                    reject('empty index')
                    cleanup()
                    this.emit('ready')
                }                
            })
            this.indexer.start()
        })
	}
    reload(){
        this.indexer && this.indexer.destroy()
        this.started = false
        return this.start()
    }
    setIndex(index, cb){
        this.index = index
        this.verify(this.index).then(ret => {
            this.quality = ret.quality
            this.relevance = ret.relevance
            cb()
        }).catch(err => {
            this.quality = 0
            this.relevance = 0
            cb(err)
        })
    }
	progress(){
		let p = 0
		if(this.validator) {
			p = this.validator.progress()
		} else if(this.isReady || (this.indexer && this.indexer.hasFailed)) {
			p = 100
		}
		return p
	}
	verify(index){
		return new Promise((resolve, reject) => {
		    this.verifyListQuality().then(quality => {
                const relevance = quality ? this.verifyListRelevance(index) : {total: 0, err: 'list streams seems offline'}
                resolve({quality, relevance})
            }).catch(err => {
                reject(err)
            })
        })
	}
	async verifyListQuality(){
        if(this.skipValidating){
            return true
        }
        let len = this.index.length
        if(!len){
            throw 'insufficient streams '+ len
        }
        let tests = Math.min(len, 10), mtp = Math.floor((len - 1) / (tests - 1))
        let ids = []
        for(let i = 0; i < len; i += mtp) ids.push(i)
        let entries = await this.indexer.entries(ids)
        const urls = entries.map(e => e.url)
        if(this.debug){
            console.log('validating list quality', this.url, tests, mtp, urls)
        }
        const racing = new ConnRacing(urls, {retries: 1, timeout: 5})
		for(let i=0; i<urls.length; i++){
            const res = await racing.next().catch(console.error)
            if(res && res.valid){
                return 100 / i
            }            
        }
		throw 'no valid links'
	}
	verifyListRelevance(index){
        const values = {
            hits: 0
        }
        const factors = {
            relevantKeywords: 1,
            mtime: 0.25,
            hls: 0.25
        }

        // relevantKeywords (check user channels presence in these lists and list size by consequence)
        let rks = this.parent() ? this.parent().relevantKeywords : this.relevantKeywords
		if(!rks || !rks.length){
			console.error('no parent keywords', this.parent(), this.relevantKeywords, rks)
			values.relevantKeywords = 50
		} else {
            let hits = 0
            rks.forEach(term => {
                if(typeof(index.terms[term]) != 'undefined'){
                    hits++
                }
            })
            values.relevantKeywords = hits / (rks.length / 100)
        }
    
        /*
        // hls
        values.hls = index.hlsCount / (index.length / 100)

        // mtime
        const rangeSize = 30 * (24 * 3600), now = global.time(), deadline = now - rangeSize
        if(!index.lastmtime || index.lastmtime < deadline){
            values.mtime = 0
        } else {
            values.mtime = (index.lastmtime - deadline) / (rangeSize / 100)
        }
        */

        let log = '', total = 0, maxtotal = 0
        Object.values(factors).map(n => maxtotal += n)
        Object.keys(factors).forEach(k => {
            if(typeof(values[k]) == 'number' && typeof(factors[k]) == 'number'){
                log += k +'-'+ typeof(values[k]) +'-'+ typeof(factors[k]) +'-(('+ values[k] +' / 100) * '+ factors[k] +')'
                total += ((values[k] / 100) * factors[k])
            }
        })
        values.total = total / maxtotal
        values.debug = {values, factors, total, maxtotal, log}

        //console.warn('LIST RELEVANCE', this.url, index.lastmtime, Object.keys(values).map(k => k +': '+ values[k]).join(', '))

		return values
	}
	iterate(fn, map, cb){
		if(!Array.isArray(map)){
			map = false
		}
        this.indexer.entries(map).then(entries => {
            entries.some(e => {
                let ret = fn(e)
                return ret === this.constants.BREAK
            })
        }).catch(console.error).finally(cb)
	}
	async fetchAll(){
        await this.ready()
        if(!this.indexer) return []
        return await this.indexer.entries()
	}
    async getMap(map){
        await this.ready()
        if(!this.indexer) return []
        return await this.indexer.getMap(map)
    }
	reset(){		
		this.index = {
            length: 0,
            terms: {},
            groups: {},
            meta: {}
        }
		this.indexateIterator = 0
	}
	destroy(){
		if(!this.destroyed){
			this.destroyed = true
			this.reset()
            if(this.indexer){
                this.indexer.destroy()
                this.indexer = null
            }
			if(this.rl){
				this.rl.close()
				this.rl = null
			}
			if(this.validator){
				this.validator.destroy()
				this.validator = null
			}
			this.emit('destroy')
            this.removeAllListeners()
			this.parent = (() => {return {}})
			this._log = []
		}
	}
}

module.exports = List
