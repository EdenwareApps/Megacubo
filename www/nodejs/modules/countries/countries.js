const { EventEmitter } = require('events')

class Countries extends EventEmitter {
	constructor(){
		super()

		const path = require('path')
		this.data = require('./countries.json')
	}
	query(fields, where = {}, orderBy, desc) {
		const ret = []
		if (typeof (fields) == 'string' && fields) {
			fields = fields.split(',')
		}
		orderBy && (fields.includes(orderBy) || fields.push(orderBy))
		for (var key in this.data) {
			const fine = Object.keys(where).every(by => {
				if (typeof (where[by]) == 'function') {
					return where[by](this.data[key][by])
				} else if (Array.isArray(where[by])) {
					return where[by].includes(this.data[key][by])
				} else {
					return where[by] == this.data[key][by]
				}
			})
			if (fine) {
				const result = {}
				if (fields) {
					fields.forEach(k => result[k] = this.data[key][k])
				} else {
					Object.assign(result, this.data[key])
				}
				ret.push(result)
			}
		}
		if (orderBy) {
			let sorter
			if (typeof (orderBy) == 'function') {
				sorter = orderBy
			} else if (desc) {
				sorter = (a, b) => {
					return (a[orderBy] > b[orderBy]) ? -1 : ((a[orderBy] < b[orderBy]) ? 1 : 0)
				}
			} else {
				sorter = (a, b) => {
					return (a[orderBy] > b[orderBy]) ? 1 : ((a[orderBy] < b[orderBy]) ? -1 : 0)
				}
			}
			return ret.sort(sorter)
		}
		return ret
	}
	getRow(field, where={}, orderBy, desc) {
		const results = this.query(field, where, orderBy, desc)
		return results.shift()
	}
	getVar(field, where={}, orderBy, desc) {
		const result = this.getRow(field, where, orderBy, desc)
		return result[field]
	}
	countryCodeExists(code){
		return this.data.some(c => c.code == code)
	}
	getCountry(code){
		return this.getRow('', {code})
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
	orderCodesBy(codes, field, desc=true) {
		const results = this.query('code', {code: codes}, field, desc)
		return results.map(c => c.code)
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
		let fromCountry = this.getCountry(fromCode)
		let dists = dests.map(code => {
			let country = this.getCountry(code)
			if(country){
				country.dist = this.getDistance(fromCountry, country)
				return country
			}
		}).filter(c => c).sortByProp('dist')
		return dists.slice(0, amount).map(c => c.code)
	}
	getNearestPopulous(fromCode, dests, amount){
		let scores = [], countries = {}
		let fromCountry = this.getCountry(fromCode)
		let maxDistance = 0
		let maxPopulation = 0
		let minPopulation = Number.MAX_SAFE_INTEGER
		let minDistance = Number.MAX_SAFE_INTEGER
		for(const code of dests) {
			const country = this.getCountry(code)
			if(country){
				country.dist = this.getDistance(fromCountry, country)
				if(minDistance > country.dist) {
					minDistance = country.dist
				}
				if(maxDistance < country.dist) {
					maxDistance = country.dist
				}
				if(minPopulation > country.population) {
					minPopulation = country.population
				}
				if(maxPopulation < country.population) {
					maxPopulation = country.population
				}
				countries[code] = country
			}
		}
		for(const code of Object.keys(countries)) {
			const scorePopulation = (countries[code].population - minPopulation) / (maxPopulation - minPopulation)
			const scoreDistance = 1 - (countries[code].dist / maxDistance)
			const score = (scorePopulation * 3) + scoreDistance // more weight for population
			scores.push({code, score})
		}
		return scores.sortByProp('score', true).slice(0, amount).map(c => c.code)
	}
}

module.exports = Countries