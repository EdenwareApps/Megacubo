
class Mega {
    constructor(){

    }  
	getDomain(u){
    	if(u && u.indexOf('//')!=-1){
	        let domain = u.split('//')[1].split('/')[0]
        	if(domain == 'localhost' || domain.indexOf('.') != -1){
	            return domain.split(':')[0]
        	}
    	}
    	return ''
	}
	isMega(url){
		if(typeof(url) != 'string'){
			return false
		}
		return url.substr(0, 7) == 'mega://'      
	}	
	parse(megaUrl){
		if(this.isMega(megaUrl)){
			let mediaType = 'live', url = '', name = '', qs = {}, type = 'name'
			let parts = megaUrl.substr(7).split('#')[0]
			parts = parts.split('?')
			if(parts[0].charAt(parts[0].length - 1) == '/'){
				parts[0] = parts[0].substr(0, parts[0].length - 1)
			}
			try {
				let tmp = global.decodeURIComponentSafe(parts[0])
				parts[0] = tmp
			} catch(e) {
				console.error(e, megaUrl)
			}
			if(parts.length > 1){
				qs = this.qs2Object(parts[1])
				if(typeof(qs.mediaType) != 'undefined' && !['live', 'video'].includes(qs.mediaType)){
					delete qs.mediaType // avoid bad mediaType
				}
			}
			let nparts = parts[0].split('|')
			if(nparts.length > 1){
				if(nparts[0] == 'link'){
					type = 'link'
					url = Buffer.from(nparts[1], 'base64').toString()
				} else {
					name = nparts[1]
				}
			} else {
				name = nparts[0]
			}
			if(url && !name){
				name = 'Megacubo '+ this.getDomain(url)
			} else if(name.charAt(name.length - 1) == '/'){
				name = name.substr(0, name.length - 1)
			}
			let ret = {name, type, mediaType, url}
			Object.keys(qs).forEach(k => {
				if(qs[k]){
					ret[k] = qs[k]
				}
			})
			return ret
		}
		return false
	}	
	build(name, params){
		let mega = 'mega://' + name
		if(params){
			mega += '?' + this.object2QS(params)
		}
		return mega
	}	
	compare(url, url2){
		let a = this.parse(url), b = this.parse(url2)
		if(a && b){
            return a.name == b.name
		}
	}	
	validate(url){
		var data = this.parse(url)
		if(data){
			if(data.type == 'play'){
				if(data.name.length > 2 ){
					return true
				}
			} else if(data.type == 'link') {
				if(data.url.indexOf('/') != -1){
					return true
				}
			}
		}
	}
	qs2Object(qs){
		let _params = new URLSearchParams(qs)
		let query = Array.from(_params.keys()).reduce((sum, value)=>{
			return Object.assign({[value]: global.decodeURIComponentSafe(_params.get(value))}, sum)
		}, {})
		return query
	}
	object2QS(o){
		let qs = []
		Object.keys(o).forEach(k => {
			qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k]))
		})
		return qs.join('&')
	}
}

module.exports = Mega
