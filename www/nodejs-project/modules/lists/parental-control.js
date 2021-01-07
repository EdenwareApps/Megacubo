
const Events = require('events')

class ParentalControl extends Events {
	constructor(){
		super()
		this.termsRegex = false
		this.setupTerms()
		this.update()
	}
	setupTerms(){
		this.terms = this.keywords(global.config.get('parental-control-terms'))		
		if(this.terms.length){
			this.termsRegex = new RegExp(this.terms.join('|').replace(new RegExp('\\+', 'g'), '\\+'), 'i')
		} else {
			this.termsRegex = false
		}
		this.update()
	}
	setTerms(terms){
		if(typeof(terms) == 'string'){
			this.terms = this.keywords(terms)	
		} else if(!Array.isArray(terms)) {
			console.error('Bad terms format', terms)
			return
		}
		this.terms = [...new Set(this.terms)] // make unique
		let sterms = this.terms.join(',')
		global.config.set('parental-control-terms', sterms)
		this.emit('updated')
		if(this.terms.length){
			this.termsRegex = new RegExp(this.terms.join('|').replace(new RegExp('\\+', 'g'), '\\+'), 'i')
		} else {
			this.termsRegex = false
		}
	}
	update(){
		if(global.config.get('parental-control-terms') == global.config.defaults['parental-control-terms']){ // update only if the user didn't customized
			global.cloud.get('configure').then(c => {
				if(c && c.adultTerms){
					this.terms = this.terms.concat(this.keywords(c.adultTerms))
					if(this.terms.length){
						this.terms = [...new Set(this.terms)]
						global.config.set('parental-control-terms', this.terms.join(','))
					}
				}
				this.emit('updated')
			}).catch(console.error)
		}
	}
	keywords(str){
		return str.toLowerCase().split(',').filter(t => {
			return t.length >= 2
		})
	}
	has(stack){
		return this.termsRegex ? stack.match(this.termsRegex) : false
	}
	allow(entry){
		if(typeof(entry) == 'string'){
			return !this.has(entry)
		}
		if(entry.type && !['group', 'stream'].includes(entry.type)){
			return true
		}
		let allow = true
		let str
		str = entry.name
		if(entry.group){
			str += ' ' + entry.group
		}
		if(str && this.has(str)){
			allow = false
		}
		return allow
	}
	filter(entries){
		if(entries.length){
			switch(global.config.get('parental-control-policy')){
				case 'block':
					entries = entries.filter(this.allow.bind(this))
					break
				case 'only':
					entries = entries.filter(e => {
						if(typeof(e) != 'string' && e.type && !['group', 'stream'].includes(e.type)){
							return true
						}
						return !this.allow(e)
					})
					break
			}
		}
		return entries
	}
}

module.exports = ParentalControl
