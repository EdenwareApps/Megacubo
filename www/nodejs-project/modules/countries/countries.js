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
	getCountriesFromTZ(tzMins){
		return this.data.map(c => c.tz && c.tz.includes(tzMins) ? c.code : false).filter(c => c)
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
			targetLanguage = targetLanguage.substr(0, 2).toLowerCase()
		}
		this.data.some(c => {
			if(c.code == code){
				if(targetLanguage && c[targetLanguage]){
					name = c[targetLanguage]
				} else {
					name = c.iso || c.code
				}
				return true
			}
		})
		return name
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