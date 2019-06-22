
const path = require('path'), fs = require('fs')

class StorageController {
	constructor(folder){
		this.debug = false
		this.cache = {}
		this.folder = folder
		this.cacheMemSizeLimit = (56 * 1024) /* 56kb */
		this.dir = this.folder + path.sep
		fs.stat(this.dir, (err, stat) => {
			if(err !== null) {
				fs.mkdir(this.dir, (err) => {

				})
			}
		})
	}
	time(){
		return ((new Date()).getTime() / 1000)
	}
	hash(txt){
		var hash = 0
		if (txt.length == 0) {
			return hash
		}
		for (var i = 0; i < txt.length; i++) {
			var char = txt.charCodeAt(i)
			hash = ((hash<<5)-hash)+char
			hash = hash & hash // Convert to 32bit integer
		}
		return hash
	}  
	resolve(key){
		key = key.replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '').substr()
		return this.dir + key.substr(0, 128) + '.json'
	}
	get(key){
		var f = this.resolve(key), _json = null, val = null 
		if(typeof(this.cache[key])!='undefined'){
			return this.cache[key]
		}
		if(fs.existsSync(f)){
			_json = fs.readFileSync(f, "utf8")
			if(Buffer.isBuffer(_json)){ // is buffer
				_json = String(_json)
			}
			if(typeof(_json)=='string' && _json.length){
				try {
					var r = JSON.parse(_json)
					if(r != null && typeof(r)=='object' && (r.expires === null || r.expires >= this.time())){
						val = r.data
						if(r.data.length < this.cacheMemSizeLimit){
							this.cache[key] = val
						}
					} else {
						if(this.debug){
							console.error('Expired', r.expires+' < '+this.time())
						}
					}
				} catch(e){
					console.error(e, f)
				}
			} else {
				if(this.debug){
					console.error('Bad type', typeof(_json))
				}
			}
		} else {
			if(this.debug){
				console.error('Not found', typeof(_json))
			}
		}
		return val
	}
	set(key, val, expiration){
		var f = this.resolve(key)
		if(expiration === false) {
			expiration = 0 // false = session only
		} else if(expiration === true || typeof(expiration) != 'number') {
			expiration = 365 * (24 * 3600) // true = for one year
		}
		try {
			if(fs.existsSync(f)){
				fs.truncateSync(f, 0)
			}
			let buf = JSON.stringify({data: val, expires: this.time() + expiration})
			fs.writeFileSync(f, buf, "utf8")
			if(buf.length < this.cacheMemSizeLimit){
				this.cache[key] = val
			}
		} catch(e){
			console.error(e)
		}
	}
	cleanup(){
		// TODO
	}
}   

module.exports = StorageController
