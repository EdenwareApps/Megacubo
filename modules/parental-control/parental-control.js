
class ParentalControl {
	constructor(terms){
		if(typeof(terms) != 'string'){
			terms = 'adult,erotic,erótic,sex,porn,+18';
		}
		this.terms = this.keywords(terms)
	}
	keywords(str){
		return str.toLowerCase().split(',').filter(t => {
			return t.length >= 2
		})
	}
	has(stack){
		if(stack.length > 2){
			stack = stack.toLowerCase()
			for(let i = 0; i<this.terms.length; i++){
				if(stack.indexOf(this.terms[i]) != -1){
					return true
				}
			}
		}
		return false
	}
	allow(entry){
		let allow = true, str
		str = entry.name
		if(entry.group){
			str += ' ' + entry.group
		}
		if(str && this.has(str)){
			allow = false
		}
		return allow
	}
}

module.exports = ParentalControl
