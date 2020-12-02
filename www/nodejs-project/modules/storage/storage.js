
const path = require('path'), fs = require('fs'), Queue = require('./queue')

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
			this.folder = global.paths['temp']
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
	resolve(key, expiralFile){
		key = key.replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '').substr()
		return this.dir + key.substr(0, 128) + (expiralFile === true ? '.expires.json' : '.json')
	}
	unresolve(file){
		return path.basename(file).replace('.expires', '').replace('.json', '')
	}
}

class StorageAsync extends StorageBase {
	constructor(label, opts){
		super(label, opts)
	}
	get(key, cb, encoding){
		this.queue.add(key, this._get.bind(this, key, cb, encoding))
	}
	set(key, val, expiration, cb){
		this.queue.add(key, this._set.bind(this, key, val, expiration, cb))
	}
	_get(key, cb, encoding){
		return new Promise((resolve, reject) => {
			if(encoding !== null && typeof(encoding) != 'string'){
				encoding = 'utf-8'
			}
			if(typeof(cb) != 'function'){
				cb = () => {}
			}
			this.expiration(key, expiral => {
				let now = this.time()
				if(expiral > now){
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
										if(typeof(this.cacheExpiration[key]) == 'undefined'){
											this.cacheExpiration[key] = expiral
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
					cb(null)
					reject('expired')
				}
			})
		})
	}
	_set(key, val, expiration, cb){
		return new Promise((resolve, reject) => {
			let j, x, f = this.resolve(key), fe = this.resolve(key, true)
			if(expiration === false) {
				expiration = 600 // default = 10min
			} else if(expiration === true || typeof(expiration) != 'number') {
				expiration = this.maxExpiration // true = forever (100 years)
			}
			x = this.time() + expiration
			if(this.useJSON){
				j = JSON.stringify(val)
				this.cacheExpiration[key] = x
			}
			this.write(f, typeof(j) == 'undefined' ? val : j, 'utf8', cb)	
			this.write(fe, x, 'utf8', () => {})
			resolve(true)
		})
	}
	expiration(key, cb){
		if(typeof(this.cacheExpiration[key]) == 'undefined'){
			let n = 0, f = this.resolve(key, true)
			fs.stat(f, (err, stat) => {
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
						cb(n)
					})
				} else {
					cb(0)
				}
			})
		} else {
			cb(this.cacheExpiration[key])
		}
	}
	ttl(key, cb){
		this.expiration(key, expires => {
			let now = this.time()
			cb((!expires || now > expires) ? 0 : (expires - now))
		})
	}
	write(file, val, enc, cb){
		if(typeof(val) == 'number'){
			val = String(val)
		}
		if(typeof(cb) != 'function'){
			cb = () => {}
		}
		fs.writeFile(file, val, enc, cb)
	}
}

class StorageSync extends StorageAsync {
	constructor(label, opts){
		super(label, opts)
	}
	getSync(key){
		let data = undefined
		if(this.hasSync(key)){
			let expiral = typeof(this.cacheExpiration[key]) == 'undefined' ? this.expirationSync(key) : this.cacheExpiration[key]
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
		let expires = typeof(this.cacheExpiration[key]) == 'undefined' ? this.expirationSync(key) : this.cacheExpiration[key], now = this.time()
		return (!expires || now > expires) ? 0 : (expires - now)
	}
	expirationSync(key){
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
		let expiral = typeof(this.cacheExpiration[key]) == 'undefined' ? this.expirationSync(key) : this.cacheExpiration[key]
		if(expiral > this.time()){
			let f = this.resolve(key), _json = null
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
		let f = this.resolve(key), fe = this.resolve(key, true)
		fs.unlink(f, typeof(cb) == 'function' ? cb : (() => {}))
		fs.unlink(fe, () => {})
		delete this.cacheExpiration[key]
	}
	cleanup(){
		let suffix = '.expires.json', now = this.time()
		fs.readdir(this.folder, {}, (err, files) => {
			files.filter(f => {
				return f.indexOf(suffix) != -1
			}).map(f => {
				let key = f.replace(suffix, '')
				if(this.expirationSync(key) <= now){
					fs.unlink(f, () => {})
					fs.unlink(f.replace(suffix, '.json'), () => {})
					delete this.cacheExpiration[key]
				}
			})
		})
	}
	clear(){
		fs.readdir(this.folder, {}, (err, files) => {
			files.map(f => {
				fs.unlink(this.folder + path.sep + f, () => {})
			})
			this.cacheExpiration = {}
		})
	}
}   

module.exports = Storage
