
const path = require('path'), fs = require('fs'), async = require('async'), Queue = require('./queue')

class StorageBase {
	constructor(label, opts){		
		this.opts = {
			temp: false,
			clear: false,
			cleanup: true
		}
		if(opts){
			this.opts = Object.assign(this.opts, opts)
		}
		this.debug = false
		this.queue = new Queue()
		this.cacheExpiration = {}
		this.maxExpiration = 100 * (365 * (24 * 3600))
		if(this.opts.temp){
			this.folder = global.paths.temp
		} else {
			this.folder = global.paths['data']
		} 
		this.folder += '/storage'
		if(typeof(label) == 'string' && label){
			this.folder += '/' + label
		}
		this.dir = this.folder + '/'
		this.useJSON = true		
		fs.stat(this.folder, (err, stat) => {
			if(err){
				fs.mkdir(this.dir, {recursive: true}, (err) => {
					if (err){
						console.error(err)
					}
				})
			} else {
				if(this.opts.clear){
					this.clear()
				} else if(this.opts.cleanup) {
					this.cleanup()
				}
			}
		})
	}
	time(){
		return parseInt((new Date()).getTime() / 1000)
	}
	resolve(key, expiralFile){ // key to file
		return this.dir + this.prepareKey(key) + (expiralFile === true ? '.expires.json' : '.json')
	}
	unresolve(file){ // file to key
		return path.basename(file).replace('.expires', '').replace('.json', '')
	}
	prepareKey(key){ // should give same result if called multiple times
		return key.replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '').substr(0, 128)
	}
}

class StorageAsync extends StorageBase {
	constructor(label, opts){
		super(label, opts)
	}
	get(key, cb, encoding){
		key = this.prepareKey(key)
		this.queue.add(key, this._get.bind(this, key, cb, encoding))
	}
	set(key, val, expiration, cb){
		key = this.prepareKey(key)
		if(global.isExiting){
			this.setSync(key, val, expiration)
			return cb()
		}
		this.queue.add(key, this._set.bind(this, key, val, expiration, cb))
	}
	_get(key, cb, encoding){
		return new Promise((resolve, reject) => { // promise is used by queue
			if(encoding !== null && typeof(encoding) != 'string'){
				encoding = 'utf-8'
			}
			if(typeof(cb) != 'function'){
				cb = () => {}
			}
			this.expiration(key, expiral => {
				let now = this.time()
				if(expiral > now){										
					if(this.cacheExpiration[key] != expiral){
						this.cacheExpiration[key] = expiral
					}
					let data = null, f = this.resolve(key)
					fs.stat(f, (err, stat) => {
						let exists = err === null
						if(exists) {
							fs.readFile(f, {encoding}, (err, _json) => {
								if(err){
									console.error(err)
									cb(null)
								} else {

									if(this.useJSON){
										if(Buffer.isBuffer(_json)){ // is buffer
											_json = String(_json)
										}
										try {
											let j = JSON.parse(_json)
											if(j && j != null){
												data = j
												j = null
											}
										} catch(e) {
											console.error(e, f, _json)
											data = null
											// this.delete(key)
										}
										cb(data)
									} else {
										cb(_json)
									}
								}
								resolve(true)
							})
						} else {
							if(this.debug){
								console.error('Not found', f)
							}
							cb(null)
							reject('not found')
						}
					})
				} else {							
					if(this.cacheExpiration[key]){
						this.cacheExpiration[key] = 0
					}
					cb(null)
					reject('expired')
				}
			})
		})
	}
	_set(key, val, expiration, cb){
		return new Promise((resolve, reject) => { // promise is used by queue
			let j, x, f = this.resolve(key), fe = this.resolve(key, true)
			if(expiration === false) {
				expiration = 600 // default = 10min
			} else if(expiration === true || typeof(expiration) != 'number') {
				expiration = this.maxExpiration // true = forever (100 years)
			}
			x = this.time() + expiration
			this.cacheExpiration[key] = x
			if(this.useJSON){
				j = JSON.stringify(val)
			}
			this.write(f, typeof(j) == 'undefined' ? val : j, 'utf8', () => {
				if(typeof(cb) == 'function'){
					cb()
				}
				resolve(true)
			})	
			this.write(fe, x, 'utf8', () => {})
		})
	}
	expiration(key, cb){
		key = this.prepareKey(key)
		if(typeof(this.cacheExpiration[key]) == 'undefined'){
			let n = 0, f = this.resolve(key, true)
			fs.stat(f, err => {
				let exists = err === null
				if(exists){
					fs.readFile(f, (err, x) => {
						if(err){
							console.error(err)
							n = 0
						} else {
							x = parseInt(x)
							if(!isNaN(x)){
								n = x
							}
						}
						this.cacheExpiration[key] = n
						cb(n)
					})
				} else {
					this.cacheExpiration[key] = 0
					cb(0)
				}
			})
		} else {
			cb(this.cacheExpiration[key])
		}
	}
	ttl(key, cb){
		key = this.prepareKey(key)
		this.expiration(key, expires => {
			let now = this.time()
			cb((!expires || now > expires) ? 0 : (expires - now))
		})
	}
	has(key, cb){
		key = this.prepareKey(key)
		this.expiration(key, expiral => {
			if(expiral > this.time()){
				let f = this.resolve(key)
				fs.stat(f, (err, stat) => {
					if(stat && stat.size){
						cb(stat.size)
					} else {
						cb(false)
					}
				})
				return fs.existsSync(f)
			} else {
				cb(false)
			}
		})
	}
	write(file, val, enc, cb){
		if(typeof(val) == 'number'){
			val = String(val)
		}
		if(typeof(cb) != 'function'){
			cb = () => {}
		}
		let tmpFile = path.join(path.dirname(file), String(parseInt(Math.random() * 1000000))) +'.commit'	
		fs.writeFile(tmpFile, val, enc, err => { // to avoid corrupting, we'll write to a temp file first
			if(err){
				console.error(err)
				cb(err)
			} else {
				fs.rename(tmpFile, file, err => {
					if(err){
						console.error(err)
						fs.unlink(tmpFile, () => {})
					}
					cb(err)
				})
			}
		})
	}
}

class StorageSync extends StorageAsync {
	constructor(label, opts){
		super(label, opts)
	}
	getSync(key){
		let data = undefined
		key = this.prepareKey(key)
		if(this.hasSync(key)){
			let expiral = this.expirationSync(key)
			let f = this.resolve(key), _json = null
			if(fs.existsSync(f)){
				_json = fs.readFileSync(f, 'utf8')
				if(this.useJSON){
					if(Buffer.isBuffer(_json)){ // is buffer
						_json = String(_json)
					}
					try {
						let j = JSON.parse(_json)
						if(j && j != null){
							data = j
							j = null
						}
					} catch(e) {
						console.error(e, f)
						data = undefined
						// this.delete(key)
					}
					this.cacheExpiration[key] = expiral
				} else {
					data = _json
					_json = null
				}
			} else {
				if(this.debug){
					console.error('Not found', f)
				}
			}
		}
		return data
	}
	setSync(key, val, expiration){
		let f = this.resolve(key), fe = this.resolve(key, true)
		if(expiration === false) {
			expiration = 600 // default = 10min
		} else if(expiration === true || typeof(expiration) != 'number') {
			expiration = this.maxExpiration // true = forever (100 years)
		}
		try {
			let x = this.time() + expiration
			if(this.useJSON){
				let j = JSON.stringify(val)
				this.cacheExpiration[key] = x
				this.writeSync(f, j, 'utf8')
			} else {
				this.writeSync(f, val, 'utf8')
			}
			this.writeSync(fe, x, 'utf8')
		} catch(e){
			console.error(e)
		}
	}
	ttlSync(key){
		let expires = this.expirationSync(key), now = this.time()
		return (!expires || now > expires) ? 0 : (expires - now)
	}
	expirationSync(key){
		key = this.prepareKey(key)
		if(typeof(this.cacheExpiration[key]) == 'undefined'){
			let n = 0, f = this.resolve(key, true)
			if(fs.existsSync(f)){
				n = parseInt(fs.readFileSync(f, 'utf8'))
				if(isNaN(n)){
					n = 0
				}
			}
			return n
		} else {
			return this.cacheExpiration[key]
		}
	}
	hasSync(key){
		let expiral = this.expirationSync(key)
		if(expiral > this.time()){
			let f = this.resolve(key)
			return fs.existsSync(f)
		}
		return false
	}
	writeSync(file, val, enc){
		if(typeof(val) == 'number'){
			val = String(val)
		}
		fs.writeFileSync(file, val, enc)
	}
}

class Storage extends StorageSync {
	constructor(label, opts){
		super(label, opts)
	}
	delete(key, cb){
		key = this.prepareKey(key)
		let f = this.resolve(key), fe = this.resolve(key, true)
		fs.unlink(f, typeof(cb) == 'function' ? cb : (() => {}))
		fs.unlink(fe, () => {})
		delete this.cacheExpiration[key]
	}
	deleteAnyStartsWith(startsWithText, cb){
		startsWithText = this.prepareKey(startsWithText)
		fs.readdir(this.folder, {}, (err, files) => {
			if(Array.isArray(files) && files.length){
				async.eachOfLimit(files, 8, (f, i, done) => {
					if(f.substr(0, startsWithText.length) == startsWithText){
						fs.unlink(path.join(this.folder, f), done)
					} else {
						done()
					}
				})
			} else {
				if(cb){
					cb()
				}
			}
		})
	}
	deleteAnyStartsWithOlder(startsWithText, olderThanSecs, cb){
		startsWithText = this.prepareKey(startsWithText)
		let expiralSuffix = '.expires.json', deadline = this.time() - olderThanSecs
		fs.readdir(this.folder, {}, (err, files) => {
			if(Array.isArray(files) && files.length){
				async.eachOfLimit(files.filter(f => f.indexOf(expiralSuffix) != -1), 8, (f, i, done) => {
					if(f.substr(0, startsWithText.length) == startsWithText){
						let key = f.replace(expiralSuffix, '')
						this.expiration(key, expiral => {
							if(expiral <= deadline){
								fs.unlink(f, () => {
									delete this.cacheExpiration[key]
								})
								fs.unlink(f.replace(expiralSuffix, '.json'), done)
							} else {
								done()
							}
						})
					} else {
						done()
					}
				}, cb || (() => {}))
			} else {
				if(cb){
					cb()
				}
			}
		})
	}
	cleanup(cb){
		let expiralSuffix = '.expires.json', now = this.time()
		fs.readdir(this.folder, {}, (err, files) => {
			if(Array.isArray(files) && files.length){
				async.eachOfLimit(files.filter(f => f.indexOf(expiralSuffix) != -1), 8, (f, i, done) => {
					let key = f.replace(expiralSuffix, '')
					this.expiration(key, expiral => {
						if(expiral <= now){
							fs.unlink(f, () => {
								delete this.cacheExpiration[key]
							})
							fs.unlink(f.replace(expiralSuffix, '.json'), done)
						} else {
							done()
						}
					})
				}, cb || (() => {}))
			} else {
				if(cb){
					cb()
				}
			}
		})
	}
	clear(){
		fs.readdir(this.folder, {}, (err, files) => {
			if(Array.isArray(files) && files.length){
				files.map(f => fs.unlink(this.folder + path.sep + f, () => {}))
			}
			this.cacheExpiration = {}
		})
	}
}   

module.exports = Storage
