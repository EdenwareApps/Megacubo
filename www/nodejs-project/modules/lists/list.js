const Events = require('events'), ListIndex = require('./list-index'), ConnRacing = require(global.APPDIR + '/modules/conn-racing')

class List extends Events {
	constructor(url, parent){
		super(url, parent)
		this.debug = false
		if(url.substr(0, 2) == '//'){
			url = 'http:'+ url
		}
		this.url = url
        this.relevance = -1
        this.reset()
		this.dataKey = global.LIST_DATA_KEY_MASK.format(url)
        this.file = global.rstorage.resolve(this.dataKey)
        this.constants = {BREAK: -1}
		this._log = [
			this.url
		]
		this.parent = (() => parent)
	}
	log(...args){
		if(this.destroyed) return
		args.unshift((new Date()).getTime() / 1000)
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
            this.indexer = new ListIndex(this.file, this.parent())
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
                    })
                } else {
                    reject('empty index')
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
		} else if(this.index.length) {
			p = 100
		}
		return p
	}
	verify(index){
		return new Promise((resolve, reject) => {
		    this.verifyListQuality(index).then(quality => {
                resolve({quality, relevance: this.verifyListRelevance(index)})
            }).catch(err => {
                reject(err)
            })
        })
	}
	verifyListQuality(index){
		return new Promise((resolve, reject) => {
			if(this.skipValidating){
				return resolve(true)
			}
			let resolved, tests = 5, hits = 0, urls = [], results = [], len = this.index.length, mtp = Math.floor((len - 1) / (tests - 1))
			if(len < tests){
				return reject('insufficient streams')
			}
            let ids = []
			for(let i = 0; i < len; i += mtp) ids.push(i)
            this.indexer.entries(ids).then(entries => {
                const urls = entries.map(e => e.url)
                if(this.debug){
                    console.log('validating list quality', this.url, tests, mtp, urls)
                }
                this.on('destroy', () => {
                    if(!resolved){
                        resolved = true
                        reject('destroyed')
                    }
                })
                const racing = new ConnRacing(urls, {retries: 2, timeout: 10}), end = () => {
                    racing.end()
                    delete this.validator
                    let quality = hits / (urls.length / 100)
                    if(this.debug){
                        console.log('verified list quality', this.url, quality)
                    }
                    resolved = true
                    resolve(quality)
                }, next = () => {
                    if(racing.ended){
                        end()
                    } else {
                        racing.next(res => {
                            results.push(res)
                            if(res && res.valid){
                                hits++
                            }
                            next()
                        })
                    }
                }
                this.validator = racing
                next()
            }).catch(err => reject(err))
		})
	}
	verifyListRelevance(index){
		if(this.skipValidating){
			return
		}
		let rks = this.parent().relevantKeywords
		if(!rks || !rks.length){
			console.error('no parent keywords', this.parent(), rks)
			return 100
		}
		let hits = 0
		rks.forEach(term => {
			if(typeof(index.terms[term]) != 'undefined'){
				hits++
			}
		})
		let relevance = hits / (rks.length / 100)
		rks = null
		return relevance
	}
	iterate(fn, map, cb){
		if(!Array.isArray(map)){
			map = false
		}
		let line, ne, buf = []
        this.indexer.entries(map).then(entries => {
            entries.some(e => {
                let ret = fn(e)
                return ret === this.constants.BREAK
            })
        }).catch(console.error).finally(cb)
	}
	fetchAll(cb){
        this.indexer.entries().then(entries => {
            cb(entries)
        }).catch(err => {
            console.error(err)
            cb([])
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
			this.parent = (() => {return {}})
			this._log = []
		}
	}
}

module.exports = List
