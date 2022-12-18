const fs = require('fs'), path = require('path'), Events = require('events')

class Countries extends Events {
	constructor(){
		super()
		this.data = []
		this.load()
	}
	load(){
		fs.readFile(path.join(__dirname, 'countries.json'), (err, content) => {
			if(content){
				try {
					let data = global.parseJSON(String(content))
					this.data = data
				} catch(e) {
					console.error(e)
				}
			}
			this.isReady = true
			this.emit('ready')
		})
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
	select(code, retrieveKeys, by, unique){
		if(!by) by = 'code'
		var results = []
		if(typeof(retrieveKeys) == 'string' && retrieveKeys){
			retrieveKeys = retrieveKeys.split(',')
		}
		for(var key in this.data){
			if(this.data[key][by] && this.data[key][by].substr(0, code.length) == code){
				if(retrieveKeys){
					for(var i=0; i<retrieveKeys.length; i++){
						if(typeof(this.data[key][retrieveKeys[i]])!='undefined'){
							results.push(this.data[key][retrieveKeys[i]])
							break;
						}
					}
				} else {
					results.push(this.data[key])
				}
			}
		}
		return unique ? results.shift() : results
	}
	extractCountryCodes(text){
		let results = text.toLowerCase().matchAll(new RegExp('(^|[^a-z])([a-z]{2})(^|[^a-z])', 'g'))
		if(results){
			return ([...new Set(results)]).map(r => r[2]).filter(cc => this.data.some(c => c.code == cc)).reverse()
		}
		return []
	}
	nameFromCountryCode(code, targetLanguage){
		let name = ''
		if(targetLanguage && targetLanguage.length > 3){
			targetLanguage = targetLanguage.substr(0, 2)
		}
		this.data.some(c => {
			if(c.code == code){
				if(targetLanguage && c['country_' + targetLanguage]){
					name = c['country_' + targetLanguage]
				} else {
					name = c['country_iso']	|| c['code']				
				}
				return true
			}
		})
		return name
	}
}

module.exports = Countries