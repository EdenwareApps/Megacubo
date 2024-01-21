
const path = require('path'), fs = require('fs'), Events = require('events')
const Limiter = require('../limiter'), zlib = require("zlib")

class StorageTools extends Events {
	constructor(){
		super()
		this.lastSaveTime = global.time()
        this.saveLimiter = new Limiter(() => this.save().catch(console.error), 5000)
        this.alignLimiter = new Limiter(() => this.align().catch(console.error), 2000)
		process.nextTick(() => {
			if(this.opts.main) global.onexit(() => this.saveSync())
		})
	}
	async cleanup(){
		const now = global.time()
		const files = await fs.promises.readdir(this.folder).catch(() => {})
		if(Array.isArray(files) && files.length) {
			let upgraded
			for(const file of files) {
				if(file == 'storage-index.json') continue
				const ext = file.split('.').pop()
				const key = this.unresolve(file, true)
				if(ext == 'dat') {
					if(this.index[key]) {
						if(this.index[key].permanent || this.index[key].expiration > now) continue // fine
					}
					this.delete(key, this.folder +'/'+ file)
				} else if(ext == 'json') {
					upgraded = true
					await this.upgrade(file)					
				} else {
					fs.promises.unlink(this.folder +'/'+ file).catch(() => {})
				}
			}
			for(const f of files.filter(f => f.split('.').pop() == 'commit')) {
				const file = this.folder +'/'+ f
				const stat = await fs.promises.stat(file).catch(() => {})
				if(stat && typeof(stat.size) == 'number') {
					const mtime = stat.mtimeMs / 1000
					if((now - mtime) > 30) {
						fs.promises.unlink(file, () => {}).catch(() => {})
					}
				}
			}
			if(upgraded) global.rmdir(this.folder +'/dlcache', true)
		}
	}
	async clear(force){
		for(const k of Object.keys(this.index)) {
			if(force || !this.index[k].permanent) {
				await fs.promises.unlink(this.resolve(k, true), () => {})
				delete this.index[k]
			}
		}
		this.saveLimiter.call()
	}
	async compress(data) {
		return await new Promise((resolve, reject) => {
			zlib.gzip(data, (err, result) => {
				if(err) return reject(err)
				resolve(result)
			})
		})
	}
	async decompress(data) {
		return await new Promise((resolve, reject) => {
			zlib.gunzip(data, (err, result) => {
				if(err) return reject(err)
				resolve(result)
			})
		})
	}
	async upgrade(ofile) { // compat with older versions
		let reason = 'unknown'
		const file = ofile.endsWith('.expires.json') ? ofile.replace('.expires.json', '.json') : ofile
		const efile = file.replace('.json', '.expires.json')
		const tfile = file.replace('.json', '.dat')
		const key = this.unresolve(tfile)
		const tstat = await fs.promises.stat(this.folder +'/'+ tfile).catch(() => {})
		if(!tstat || typeof(tstat) != 'number') {
			let expiration = parseInt(await fs.promises.readFile(this.folder +'/'+ efile).catch(() => {}))
			if(!isNaN(expiration)) {
				let err
				let content = await fs.promises.readFile(this.folder +'/'+ file).catch(e => err = e)
				if(!err && content) {
					const movedToConfigKeys = ['bookmarks', 'history', 'epg-history']
					let raw = true
					try {
						let parsed = JSON.parse(content)
						content = parsed
						raw = false
					} catch(e) { }
					if(movedToConfigKeys.includes(key)) {
						config.set(key, content)
					} else {
						await this.set(key, content, {expiration, raw})
					}
					await fs.promises.unlink(this.folder +'/'+ file).catch(() => {})
					await fs.promises.unlink(this.folder +'/'+ efile).catch(() => {})
					console.error('+++++++ UPGRADED '+ tfile)
					return // upgraded
				} else {
					reason = 'no content or error: '+ err
				}
			} else {
				reason = 'bad expiration value'
			}
		} else {
			reason = 'newer file exists'
		}
		await fs.promises.unlink(this.folder +'/'+ file).catch(() => {})
		await fs.promises.unlink(this.folder +'/'+ efile).catch(() => {})
		console.error('+++++++ NOT UPGRADED '+ ofile +' :: '+ reason)
	}
	size() {
		let usage = 0
		Object.keys(this.index).forEach(k => {
			if(typeof(this.index[k].size) == 'number') {
				usage += this.index[k].size
			}
		})
		return usage
	}
}

class StorageIndex extends StorageTools {
	constructor() {
		super()
		this.index = {}
		this.syncInterval = 30000
		process.nextTick(() => { // wait options to be set (folder)				
			this.indexFile = this.folder +'/storage-index.json'
			this.load().catch(console.error)
		})
	}
	async load() {
		let err, index = await fs.promises.readFile(this.indexFile, {encoding: 'utf8'}).catch(e => err = e)
		if(!err && typeof(index) == 'string') {
			try {
				index = JSON.parse(index)
				Object.keys(index).forEach(k => { // add to index new keys from worker
					if(!this.index[k] || this.index[k].time < index[k].time) {
						this.index[k] = index[k]
					}
				})
			} catch(e) {
				console.error(e)
			}
		}
	}
	mtime() {
		const lastTouchTime = Math.max(...Object.keys(this.index).map(k => this.index[k].time)) || 0
		return Math.max(lastTouchTime, this.lastAlignTime || 0)
	}
	async save() {
		if(this.mtime() < this.lastSaveTime) return
		this.lastSaveTime = global.time()
		const tmp = this.folder +'/'+ parseInt(Math.random() * 100000) +'.commit'
		await fs.promises.writeFile(tmp, JSON.stringify(this.index), 'utf8').catch(console.error)
		try {
			await fs.promises.unlink(this.indexFile).catch(console.error)
			await fs.promises.rename(tmp, this.indexFile)
		} catch(err) {
			fs.promises.unlink(tmp).catch(console.error)
			throw err
		}
	}
	saveSync() {
		if(this.mtime() < this.lastSaveTime) return
		this.lastSaveTime = global.time()
		const tmp = this.folder +'/'+ parseInt(Math.random() * 100000) +'.commit'
		fs.writeFileSync(tmp, JSON.stringify(this.index), 'utf8')
		try {
			fs.unlinkSync(this.indexFile)
			fs.renameSync(tmp, this.indexFile)
		} catch(e) {
			fs.unlinkSync(tmp)
		}
	}
	async align() {
		let now = global.time(), left = this.opts.maxDiskUsage
		this.lastAlignTime = now
		const ordered = Object.keys(this.index).filter(a => {
			if(this.index[a].permanent) {
				left -= this.index[a].size
				return false
			}
			return true
		}).sort((a, b) => {
			return (this.index[a].time > this.index[b].time) ? 1 : (this.index[a].time < this.index[b].time) ? -1 : 0
		})
		const removals = ordered.filter(a => {
			if(typeof(this.index[a].size) == 'number') {
				left -= this.index[a].size
			}
			return left <= 0
		})
		console.error('Removals ('+ left +'): '+ removals.join(', '))
		for(const key of removals) {
			const file = this.resolve(key, true)
			const size = this.index[key].size
			const elapsed = now - this.index[key].time
			fs.promises.unlink(file).catch(() => {})
			console.error('LRU cache eviction '+ key +' ('+ global.kbfmt(size) +') after '+ elapsed +'s idle')
			this.delete(key)
		}
		this.saveLimiter.call() // always
	}
	async touch(key, atts, silent) { // atts=false to not create if it doesn't exists already
		key = this.prepareKey(key)
		if(atts && atts.delete === true) { // IPC sync only
			if(this.index[key]) {
				delete this.index[key]
			}
			return
		}
		const time = parseInt(global.time())
		if(!this.index[key]) {
			if(atts === false) return
			this.index[key] = {}
		}
		const entry = this.index[key]
		if(!atts) atts = {}
		entry.time = time
		if(atts.size === 'auto' || typeof(entry.size) == 'undefined') {
			const stat = await fs.promises.stat(this.resolve(key, true)).catch(() => {})
			if(stat && stat.size) {
				atts.size = stat.size
			} else {
				delete atts.size
			}
		}
		atts = this.calcExpiration(atts || {}, entry)
		if(!atts.expiration || 
			atts.expiration < 
			entry.expiration) {
			delete atts.expiration
		}
		this.index[key] = Object.assign(entry, atts)
		silent || this.emit('touch', key, this.index[key])
		if(this.opts.main) { // only main process should align/save index, worker will sync through IPC		
			this.alignLimiter.call() // will call saver when done
		}
	}
}

class StorageIO extends StorageIndex {
	constructor() {
		super()
	}
	async get(key, encoding) {
		key = this.prepareKey(key)
		if(!this.index[key]) return null
		if(encoding !== null && typeof(encoding) != 'string'){
			if(this.index[key].compress) {
				encoding = null
			} else {
				encoding = 'utf-8'
			}
		}
		this.touch(key, false)
		await this.lock(key, false)
		const now = global.time()
		if(this.index[key].expiration < now) return null
		const file = this.resolve(key)
		const stat = await fs.promises.stat(file).catch(() => {})
		const exists = stat && typeof(stat.size) == 'number'
		if(exists) {
			let err
			this.touch(key, {size: stat.size})
			const content = await fs.promises.readFile(file, {encoding}).catch(e => err = e)
			if(err) {			
				if(this.index[key].compress) {
					content = await this.decompress(content)
				}
				if(this.index[key].raw) {
					return content
				} else {
					if(Buffer.isBuffer(content)) { // is buffer
						content = String(content)
					}
					if(content != 'undefined') {
						try {
							let j = global.parseJSON(content)
							if(j && j != null){
								return j
							}
						} catch(e) {}
					}
				}
			}
		}
		return null
	}
	async set(key, content, atts){
		key = this.prepareKey(key)
		const lock = await this.lock(key), t = typeof(atts)
		if(t == 'boolean' || t == 'number') {
			if(t == 'number') {
				atts += global.time()
			}
			atts = {expiration: atts}
		}
		if(atts.encoding !== null && typeof(atts.encoding) != 'string'){
			if(atts.compress) {
				atts.encoding = null
			} else {
				atts.encoding = 'utf-8'
			}
		}
		let file = this.resolve(key)
		if(atts.raw && typeof(content) != 'string' && !Buffer.isBuffer(content)) atts.raw = false
		if(!atts.raw) content = JSON.stringify(content)
		if(atts.compress) content = await this.compress(content)
		await this.write(file, content, atts.encoding).catch(console.error)
		this.touch(key, Object.assign(atts, {size: content.length}))
		lock.release()
	}
	calcExpiration(atts, prevAtts) {
		if(typeof(atts.expiration) == 'number') return atts
		const now = global.time()
		if(typeof(atts.ttl) == 'number') {
			atts.expiration = now + atts.ttl
			delete atts.ttl
		} else if(!atts.expiration && !atts.ttl && !atts.permanent) {
			atts.expiration = now + 600 // default = 10min
			if(prevAtts && prevAtts.expiration > atts.expiration) {
				atts.expiration = prevAtts.expiration
			}
		} else {
			atts.expiration = now + this.maxExpiration // true = forever (100 years)
		}
		return atts
	}
	setTTL(key, expiration){
		if(expiration === false) {
			expiration = 600 // default = 10min
		} else if(expiration === true || typeof(expiration) != 'number') {
			expiration = this.maxExpiration // true = forever (100 years)
		}
		expiration = global.time() + expiration
		this.touch(key, {size: 'auto', expiration})
	}
	expiration(key){
		key = this.prepareKey(key)
		if(this.index[key] && this.index[key].expiration) {
			return this.index[key].expiration
		}
		return 0
	}
	async exists(key){
		key = this.prepareKey(key)
		if(this.has(key)){
			const file = this.resolve(key)
			const stat = await fs.promises.stat(file).catch(() => {})
			if(stat && typeof(stat.size) == 'number'){
				return true
			}
		}
		return false
	}
	has(key){
		key = this.prepareKey(key)
		if(!this.index[key]) return false
		const expiral = this.expiration(key)
		return (expiral > global.time())
	}
	async write(file, content, enc) {
		if(typeof(content) == 'number') {
			content = String(content)
		}
		const tmpFile = path.join(path.dirname(file), String(parseInt(Math.random() * 1000000))) +'.commit'	
		await fs.promises.writeFile(tmpFile, content, enc)
		await new Promise((resolve, reject) => {
			global.moveFile(tmpFile, file, err => {
				if(err){
					return resolve(false)
				}
				fs.access(tmpFile, err => {
					if(!err) fs.unlink(tmpFile, () => {})
				})
				resolve(true)
			}, 5)
		})
	}
	async delete(key, removeFile){
		key = this.prepareKey(key)
		const file = this.resolve(key) // before deleting from index
		if(this.index[key]) delete this.index[key]
		this.emit('touch', key, {delete: true}) // IPC notify
		if(removeFile !== null) await fs.promises.unlink(file).catch(() => {})
		if(removeFile && removeFile != file) await fs.promises.unlink(removeFile).catch(() => {})		
	}
}

class Storage extends StorageIO {
	constructor(opts){
		super(opts)
		this.opts = {
			maxDiskUsage: global.config.get('in-disk-caching-size') * (1024 * 1024)
		}
		opts && Object.assign(this.opts, opts)
		this.locked = {}
		this.debug = false
		this.maxExpiration = 100 * (365 * (24 * 3600))
		this.folder = global.paths.data +'/storage'
		fs.access(this.folder, err => {
			if(err) {
				fs.mkdir(this.folder, {recursive: true}, (err) => {
					if (err){
						console.error(err)
					}
				})
			} else {
				if(this.opts.main) {
					this.cleanup().catch(console.error)
				}
			}
		})
	}
	resolve(key, silent){ // key to file
		key = this.prepareKey(key)
		if(this.index[key]) {
			silent || this.touch(key, {})
			if(this.index[key].file) {
				return this.index[key].file
			}
		}
		return this.folder +'/'+ key +'.dat'
	}
	unresolve(file){ // file to key
		const key = this.prepareKey(path.basename(file).replace(new RegExp('\\.(json|dat)$'), ''))
		this.touch(key, false)
		return key
	}
	prepareKey(key){ // should give same result if called multiple times
		return String(key).replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '').substr(0, 128)
	}
	lock(key, write) {
		return new Promise((resolve, reject) => {
			if(this.locked[key]) {
				this.once('unlock-'+ key, () => {
					this.lock(key, write).then(resolve).catch(reject) // call again to prevent concurrent writing
				})
			} else {
				if(write) this.locked[key] = true
				resolve({
					release: () => {
						if(write && this.locked[key]) {
							delete this.locked[key]
							this.emit('unlock-'+ key)
						}
					}
				})
			}
		})
	}
}

module.exports = Storage
