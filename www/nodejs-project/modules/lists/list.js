const Events = require('events'), ListIndex = require('./list-index'), ConnRacing = require(global.APPDIR + '/modules/conn-racing')

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
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.once('ready', fn)
		}
	}
	start(){
		return new Promise((resolve, reject) => {
            let resolved, hasErr
            this.on('destroy', () => {
                if(!resolved){
                    reject('destroyed')
                }
            })
            this.indexer = new ListIndex(this.file)
            this.indexer.on('error', reject)
            this.indexer.on('data', index => {
                if(index.length){
                    this.setIndex(index, err => {
                        resolved = true
                        if(err){
                            reject(err)
                        } else {
                            resolve(true)
                        }
                        this.isReady = true
                        this.emit('ready')
                    })
                } else {
                    reject('empty index')
                    this.isReady = true
                    this.emit('ready')
                }                
            })
            this.indexer.start()
        })
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
		if(this.validator){
			p = this.validator.progress()
		} else if(this.isReady || this.indexer.hasFailed) {
			p = 100
		}
		return p
	}
	verify(index){
		return new Promise((resolve, reject) => {
		    this.verifyListQuality().then(quality => {
                resolve({quality, relevance: this.verifyListRelevance(index)})
            }).catch(err => {
                reject(err)
            })
        })
	}
	verifyListQuality(){
		return new Promise((resolve, reject) => {
            if(this.skipValidating){
				return resolve(true)
			}
			let resolved, hits = 0, results = [], len = this.index.length
			if(!len){
				return reject('insufficient streams '+ len)
			}
            let tests = Math.min(len, 10), mtp = Math.floor((len - 1) / (tests - 1))
            let ids = []
			for(let i = 0; i < len; i += mtp) ids.push(i)
            this.indexer.entries(ids).then(entries => {
                const urls = entries.map(e => e.url)
                if(this.debug){
                    console.log('validating list quality', this.url, tests, mtp, urls)
                }
                const racing = new ConnRacing(urls, {retries: 1, timeout: 5}), end = () => {
                    if(this.validator){
                        racing.end()
                        delete this.validator
                    }
                    if(hits){
                        //let quality = hits / (urls.length / 100) // disabled for performance
                        let quality = 100
                        if(this.debug){
                            console.log('verified list quality', this.url, quality)
                        }
                        if(!resolved){
                            resolved = true
                            resolve(quality)
                        }
                    } else {                        
                        if(!resolved){
                            resolved = true
                            reject('no valid links')
                        }
                    }
                }, next = () => {
                    if(racing.ended){
                        end()
                    } else {
                        racing.next(res => {
                            results.push(res)
                            if(res && res.valid){
                                hits++
                                end()
                            }
                            next()
                        })
                    }
                }
                this.validator = racing
                this.on('destroy', () => {
                    if(!resolved){
                        resolved = true
                        reject('destroyed')
                    }
                })
                next()
            }).catch(err => reject(err))
		})
	}
	verifyListRelevance(index){
        const values = {}
        const factors = {
            relevantKeywords: 1,
            mtime: 0.25,
            hls: 0.25
        }

        // relevantKeywords (check user channels presence in these lists and list size by consequence)
        let rks = this.parent() ? this.parent().relevantKeywords : this.relevantKeywords
		if(!rks || !rks.length){
			console.error('no parent keywords', this.parent(), this.relevantKeywords, rks)
			values.relevantKeywords = 100
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

        let total = 0, maxtotal = 0
        Object.values(factors).map(n => maxtotal += n)
        Object.keys(values).forEach(k => total += ((values[k] / 100) * factors[k]))
        values.total = total / maxtotal

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
	fetchAll(cb){
        this.ready(() => {
            this.indexer.entries().then(entries => {
                cb(entries)
            }).catch(err => {
                console.error(err)
                cb([])
            })
        })
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
