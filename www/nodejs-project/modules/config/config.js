const fs = require('fs'), path = require('path'), Events = require('events')

class Config extends Events {
	constructor(file){
		super()
		this.debug = false
		this.loaded = false
		this.file = file
		this.defaults = require('./defaults')
		this.data = Object.assign({}, this.defaults) // keep defaults object for reference
		for(var key in this.data){
			let def = typeof(this.defaults[key])
			if(def != 'undefined' && def != typeof(this.data[key])){
				console.error('Invalid value for', key, this.data[key], 'is not of type ' + def);
				this.data[key] = this.defaults[key];
			}
		}
		this.load()
	}
	reset(){
		fs.unlink(this.file, () => {})
		this.data = Object.assign({}, this.defaults)		
	}
	load(txt){
		if(!this.loaded  && (txt || fs.existsSync(this.file))){
			this.loaded = true
			var _data = typeof(txt) == 'string' ? txt : fs.readFileSync(this.file, 'utf8')
			if(_data){
				if(Buffer.isBuffer(_data)){ // is buffer
					_data = String(_data)
				}
				if(this.debug){
					console.log('DATA', _data)
				}
				if(typeof(_data)=='string' && _data.length > 2){
					_data = _data.replace(new RegExp("\n", "g"), '')
					//data = stripBOM(data.replace(new RegExp("([\r\n\t]| +)", "g"), "")); // with \n the array returns empty (?!)
					_data = JSON.parse(_data)
					if(typeof(_data) == 'object'){
						this.data = Object.assign({}, this.defaults)
						this.data = Object.assign(this.data, _data)
					}
				}
			}
		}
	}
	extend(data){
		this.defaults = Object.assign(data, this.defaults)
		this.data = Object.assign(data, this.data)
		if(this.debug){
			console.log('CONFIG EXTENDED', this.defaults, this.data)
		}
	}
	reload(txt){
		let oldData
		if(this.loaded){
			oldData = Object.assign({}, this.data)
		}
		this.loaded = false
		this.load(txt)
		if(oldData){
			let changed = []
			Object.keys(oldData).forEach(k => {
				if(!this.equal(oldData[k], this.data[k])){
					changed.push(k)
				}
			})
			if(changed.length){
				//changed.forEach(k => console.warn('config changed on reload', k, oldData[k], this.data[k]))
				this.emit('change', changed, this.data)
			}
		}
	}
	equal(a, b){
		if(a instanceof Object && b instanceof Object){
			if(JSON.stringify(a) != JSON.stringify(b)){
				return false
			}
		} else if(a != b){
			return false
		}
		return true
	}
	all(){
		this.load()
		var data = {};
		Object.keys(this.defaults).forEach((key) => {
			data[key] = typeof(this.data[key]) != 'undefined' ? this.data[key] : this.defaults[key]
		})
		return data;
	}
	clone(val){
		if(val !== null && typeof(val) == 'object'){
			if(Array.isArray(val)){
				return val.slice(0)
			} else {
				return Object.assign({}, val)
			}
		}
		return val
	}
	get(key){
		this.load()
		//console.log('DATAb', JSON.stringify(data))
		//console.log('GET', key, traceback());
		var t = typeof(this.data[key]);
		if(t == 'undefined'){
			this.data[key] = this.defaults[key];
			t = typeof(this.defaults[key]);
		}
		if(t == 'undefined'){
			return null
		} else if(t == 'object') { // avoid referencing
			return this.clone(this.data[key])
		}
		return this.data[key]
	}
	set(key, val){
		this.load()
		// avoid referencing on val
		let nval
		if(typeof(val) == 'object'){
			nval = this.clone(val)
		} else {
			nval = val
		}
		if(!this.equal(this.data[key], nval)){
			this.data[key] = nval
			this.save()
			this.emit('change', [key], this.data)
		}
	}
	setMulti(atts){
		this.load()
		let changed = []
		Object.keys(atts).forEach(k => {
			let d = typeof(this.data[k])
			if((d == 'undefined' || d == typeof(atts[k])) && !this.equal(this.data[k], atts[k])){
				this.data[k] = atts[k]
				changed.push(k)
			}
		})
		if(changed.length){
			this.save()
			this.emit('change', changed, this.data)
		}
	}
	save(){ // sync to prevent confusion
		const userConfig = {}
		Object.keys(this.data).forEach(k => {
			if(!this.equal(this.data[k], this.defaults[k])){
				userConfig[k] = this.data[k]
			}
		})
		if(!fs.existsSync(path.dirname(this.file))){
			fs.mkdirSync(path.dirname(this.file), {
				recursive: true
			})
		} 
		if(this.debug){
			console.log('SAVE', userConfig)
		}
		try { // Error: EPERM: operation not permitted, open '[...]/config.json'
			if(fs.existsSync(this.file)){
				fs.truncateSync(this.file, 0)
			}
			try {
				const jso = JSON.stringify(Object.assign({}, userConfig), null, 3);
				fs.writeFileSync(this.file, jso, 'utf8')
			} catch(e) {
				console.error(e)
			}
		} catch(e) {
			console.error(e)
		}
	}
}

module.exports = file => new Config(file)
