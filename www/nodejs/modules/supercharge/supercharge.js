function patch(scope, isBrowser){
	if (!scope.String.prototype.format) {
		Object.defineProperty(String.prototype, 'format', {
			enumerable: false,
			configurable: false,
			writable: false,
			value: function (){
				var args = arguments;
				return this.replace(/{(\d+)}/g, function(match, number) {
				return typeof args[number] != 'undefined'
					? args[number]
					: match
				})
			}
		})
	}
	if (!scope.String.prototype.matchAll) {
		Object.defineProperty(String.prototype, 'matchAll', {
			enumerable: false,
			configurable: false,
			writable: false,
			value: function(regexp) {
				var matches = []
				this.replace(regexp, function() {
					var arr = ([]).slice.call(arguments, 0)
					var extras = arr.splice(-2)
					arr.index = extras[0]
					arr.input = extras[1]
					matches.push(arr)
				})
				return matches.length ? matches : []
			}
		})
	}
	if (!scope.Array.prototype.findLastIndex) {
		Object.defineProperty(scope.Array.prototype, 'findLastIndex', {
			enumerable: false,
			configurable: false,
			writable: false,
			value: function (callback, thisArg) {
				for (let i = this.length - 1; i >= 0; i--) {
				  if (callback.call(thisArg, this[i], i, this)) return i;
				}
				return -1;
			}
		})
	} 
	if (!scope.Array.prototype.unique) {
		Object.defineProperty(scope.Array.prototype, 'unique', {
			enumerable: false,
			configurable: false,
			writable: false,
			value: function() {
				return [...new Set(this)]
			}
		})
	}
	if (!scope.Array.prototype.sortByProp) {
		Object.defineProperty(scope.Array.prototype, 'sortByProp', {
			enumerable: false,
			configurable: false,
			writable: false,
			value: function (p, reverse) {
				if(Array.isArray(this)){ // this.slice is not a function (?!)
					return this.slice(0).sort((a,b) => {
						let ua = typeof(a[p]) == 'undefined', ub = typeof(b[p]) == 'undefined'
						if(ua && ub) return 0
						if(ua && !ub) return reverse ? 1 : -1
						if(!ua && ub) return reverse ? -1 : 1
						if(reverse) return (a[p] > b[p]) ? -1 : (a[p] < b[p]) ? 1 : 0;
						return (a[p] > b[p]) ? 1 : (a[p] < b[p]) ? -1 : 0;
					})
				}
				return this
			}
		})
	}
	if (!scope.Number.prototype.between) {
		Object.defineProperty(Number.prototype, 'between', {
			enumerable: false,
			configurable: false,
			writable: false,
			value: function(a, b) {
				var min = Math.min(a, b), max = Math.max(a, b)
				return this >= min && this <= max
			}
		})
	}
	if (!scope.String.prototype.replaceAll) {
		Object.defineProperty(String.prototype, 'replaceAll', {
			enumerable: false,
			configurable: false,
			writable: false,
			value: function(search, replacement) {
				let target = String(this)
				if(target.indexOf(search) != -1){
					target = target.split(search).join(replacement)
				}
				return target
			}
		})
	}
    scope.validateURL = url => {
		if(url && url.length > 11){
			const parts = url.match(new RegExp('^(https?://|//)[A-Za-z0-9_\\-\\.\\:@]{4,}', 'i'))
			return parts && parts.length
		}
    }
	scope.deepClone = (from, allowNonSerializable) => {
		if (from == null || typeof from != "object") return from
		if (from.constructor != Object && from.constructor != Array) return from
		if (from.constructor == Date || from.constructor == RegExp || from.constructor == Function ||
			from.constructor == String || from.constructor == Number || from.constructor == Boolean)
			return new from.constructor(from)
		let to = new from.constructor()
		for (var name in from){
			if(allowNonSerializable || ['string', 'object', 'number', 'boolean'].includes(typeof(from[name]))){
				to[name] = typeof to[name] == "undefined" ? scope.deepClone(from[name], allowNonSerializable) : to[name]
			}
		}
		return to
	}
	scope.ucFirst = (str, keepCase) => {
		if(!keepCase){
			str = str.toLowerCase()
		}
		return str.replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, letter => {
			return letter.toUpperCase()
		})
	}
	scope.ts2clock = time => {
		const moment = require('moment-timezone')
		let locale = undefined, timezone = undefined
		if(typeof(time) == 'string'){
			time = parseInt(time)
		}
		time = moment(time * 1000)
		return time.format('LT')
	}
	scope.traceback = () => { 
		try { 
			var a = {}
			a.debug()
		} catch(ex) {
			return ex.stack.replace('TypeError: a.debug is not a function', '').trim()
		}
	}
    scope.joinPath = (folder, file) => {
		if(!file) return folder
		if(!folder) return file
		let ffolder = folder
		let ffile = file
		if(ffolder.indexOf('\\') != -1) {
			ffolder = scope.forwardSlashes(ffolder)
		}
		if(ffile.indexOf('\\') != -1) {
			ffile = scope.forwardSlashes(ffile)
		}
		let folderEndsWithSlash = ffolder.charAt(ffolder.length - 1) == '/'
		let fileStartsWithSlash = ffile.startsWith('/')
		if(fileStartsWithSlash && folderEndsWithSlash) {
			ret = ffolder + ffile.substr(1)
		} else if(fileStartsWithSlash || folderEndsWithSlash) {
			ret = ffolder + ffile
		} else {
			ret = ffolder +'/'+ ffile
		}
        return ret
    }
	scope.time = () => {
		return Date.now() / 1000
	}
	scope.trimExt = (text, exts) => {
		if(typeof(exts) == 'string') {
			exts = [exts]
		}
		exts.some(e => {
			if(text.endsWith('.'+ e)) {
				text = text.substr(0, text.length - (e.length + 1))
				return true
			}
		})
		return text
	}
	scope.dirname = _path => {
		let parts = _path.replace(new RegExp('\\\\', 'g'), '/').split('/')
		parts.pop()
		return parts.join('/')
	}
	if(isBrowser !== true) {
		const nodePatch = require('./supercharge-node')
		nodePatch(scope)
	}
}

if(typeof(module) != 'undefined' && typeof(module.exports) != 'undefined'){
	module.exports = patch
} else {
	patch(window, true)
}


