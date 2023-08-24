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
	countryCodeExists(code){
		return this.data.some(c => c.code == code)
	}
	getCountry(code){
		let ret
		if(typeof(code) == 'string' && code.length == 2){
			this.data.some(c => {
				if(c.code == code) {
					ret = c
					return true
				}
			})
		}
		return ret
	}
	getCountryName(code, targetLanguage){
		let row = this.getCountry(code)
		return row ? 
			(row[targetLanguage] || row['iso'])
			: ''
	}
	getCountries(){
		return this.data.map(c => c.code)
	}
	getCountriesFromTZ(tzMins){
		return this.data.map(c => c.tz && c.tz.includes(tzMins) ? c.code : false).filter(c => c)
	}
	getCountryLanguages(code) {
		let row = this.getCountry(code)
		return row ? row.languages : []
	}
    getCountriesFromLanguage(locale){ // return countries of same ui language
		let countries = []
		for(const row of this.data){
			if(row.languages.includes(locale)) {
				countries.push(row.code)
			}
		}
		return countries
    }
	extractCountryCodes(text){
		let results = text.toLowerCase().matchAll(new RegExp('(^|[^a-z])([a-z]{2})(^|[^a-z])', 'g'))
		if(results){
			return results.unique().map(r => r[2]).filter(cc => this.data.some(c => c.code == cc)).reverse()
		}
		return []
	}
	getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
		const R = 6371; // radius of earth in km
		const dLat = this.deg2rad(lat2 - lat1)
		const dLon = this.deg2rad(lon2 - lon1)
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
			Math.sin(dLon / 2) * Math.sin(dLon / 2)
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
		const d = R * c // distance in km
		return d
	}
	deg2rad(deg) {
		return deg * (Math.PI / 180)
	}
	getDistance(country1, country2) {
		const distance = this.getDistanceFromLatLonInKm(
			country1.lat, country1.lng,
			country2.lat, country2.lng
		)
		return distance
	}
	getNearest(fromCode, dests, amount){
		let from = this.select(fromCode, false, 'code', true)
		let dists = dests.map(code => {
			let c = this.select(code, false, 'code', true)
			if(c){
				c.code = code
				c.dist = this.getDistance(from, c)
				return c
			}
		}).filter(c => c).sortByProp('dist')
		return dists.slice(0, amount).map(c => c.code)
	}
}

module.exports = Countries