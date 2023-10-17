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
	scope.decodeURIComponentSafe = uri => {
		try {
			return decodeURIComponent(uri)
		} catch(e) {
			return uri.replace(new RegExp('%[A-Z0-9]{0,2}', 'gi'), x => {
				try {
					return decodeURIComponent(x)
				} catch(e) {
					return x
				}
			})
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
	scope.kfmt = (num, digits) => {
		var si = [
			{ value: 1, symbol: "" },
			{ value: 1E3, symbol: "K" },
			{ value: 1E6, symbol: "M" },
			{ value: 1E9, symbol: "G" },
			{ value: 1E12, symbol: "T" },
			{ value: 1E15, symbol: "P" },
			{ value: 1E18, symbol: "E" }
		]
		var i, rx = /\.0+$|(\.[0-9]*[1-9])0+$/
		for (i = si.length - 1; i > 0; i--) {
			if (num >= si[i].value) {
				break
			}
		}
		return (num / si[i].value).toFixed(digits).replace(rx, "$1") + si[i].symbol
	}
	scope.kbfmt = (bytes, decimals = 2) => { // https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
		if (isNaN(bytes) || typeof(bytes) != 'number') return 'N/A'
		if (bytes === 0) return '0 Bytes'
		const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
	}
	scope.kbsfmt = (bytes, decimals = 1) => { // https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
		if (isNaN(bytes) || typeof(bytes) != 'number') return 'N/A'
		if (bytes === 0) return '0 Bytes/ps'
		const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes/ps', 'KBps', 'MBps', 'GBps', 'TBps', 'PBps', 'EBps', 'ZBps', 'YBps']
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
	}
	scope.componentToHex = (c) => {
		var hex = c.toString(16);
		return hex.length == 1 ? '0' + hex : hex
	}
	scope.rgbToHex = (r, g, b) => {
		return '#'+ scope.componentToHex(r) + scope.componentToHex(g) + scope.componentToHex(b)
	}
	scope.hexToRgb = ohex => {
		var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i, hex = ohex.replace(shorthandRegex, (m, r, g, b) => {
			return r + r + g + g + b + b
		})
		var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
		return result ? {
			r: parseInt(result[1], 16),
			g: parseInt(result[2], 16),
			b: parseInt(result[3], 16)
		} : ohex
	}
    scope.ucWords = (str, force) => {
		if(!force && str != str.toLowerCase()){
			return str
		}
        return str.replace(new RegExp('(^|[ ])[A-zÀ-ú]', 'g'), letra => {
            return letra.toUpperCase()
        })
	}
	scope.ucFirst = (str, keepCase) => {
		if(!keepCase){
			str = str.toLowerCase()
		}
		return str.replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, letter => {
			return letter.toUpperCase()
		})
	}
	scope.getArrayMax = arr => { // https://stackoverflow.com/questions/42623071/maximum-call-stack-size-exceeded-with-math-min-and-math-max
		let len = arr.length
		let max = -Infinity
		while (len--) {
			if(arr[len] > max) max = arr[len]
		}
		return max
	}
	scope.getArrayMin = arr => {
		let len = arr.length
		let min = Infinity
		while (len--) {
			if(arr[len] < min) min = arr[len]
		}
		return max
	}
	scope.hmsClockToSeconds = str => {
		var cs = str.split('.'), p = cs[0].split(':'), s = 0, m = 1;    
		while (p.length > 0) {
			s += m * parseInt(p.pop(), 10);
			m *= 60;
		}    
		if(cs.length > 1 && cs[1].length >= 2){
			s += parseInt(cs[1].substr(0, 2)) / 100;
		}
		return s
	}
	scope.hmsSecondsToClock = secs => {
		var sec_num = parseInt(secs, 10); // don't forget the second param
		var hours   = Math.floor(sec_num / 3600);
		var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
		var seconds = sec_num - (hours * 3600) - (minutes * 60);    
		if (hours   < 10) {hours   = "0"+hours;}
		if (minutes < 10) {minutes = "0"+minutes;}
		if (seconds < 10) {seconds = "0"+seconds;}
		return hours+':'+minutes+':'+seconds;
	}
	scope.ts2clock = time => {
		let locale = undefined, timezone = undefined
		if(typeof(time) == 'string'){
			time = parseInt(time)
		}
		time = global.moment(time * 1000)
		return time.format('LT')
	}
	scope.getUniqueFilenameHelper = (name, i) => {
		let pos = name.lastIndexOf('.')
		if(pos == -1){
			return name + '-' + i
		} else {
			return name.substr(0, pos) + '-' + i + name.substr(pos)
		}
	}
	scope.getUniqueFilename = (files, name) => {
		let i = 0, nname = name
		while(files.includes(nname)){
			i++
			nname = scope.getUniqueFilenameHelper(name, i)
		}
		return nname
	}	
	scope.traceback = () => { 
		try { 
			var a = {}
			a.debug()
		} catch(ex) {
			return ex.stack.replace('TypeError: a.debug is not a function', '').trim()
		}
	}
	scope.forwardSlashes = path => {
		if(path && path.indexOf('\\') != -1){
			return path.replaceAll('\\', '/').replaceAll('//', '/')
		}
		return path
	}
	scope.absolutize = (path, url) => {
		if(!path) return url
		if(!url) return path
		if(path.startsWith('//')){
			path = 'http:'+ path
		}
        if(path.match(new RegExp('^[htps:]?//'))){
            return path
        }
        let uri
		try {
			uri = new URL(path, url)
			return uri.href
		} catch(e) {
			return global.joinPath(url, path)
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
		let fileStartsWithSlash = ffile.charAt(0) == '/'
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
	scope.isVODM3U8 = (content, contentLength) => {
        let sample = String(content).toLowerCase()
		if(sample.indexOf('#ext-x-playlist-type:vod') != -1) return true
		if(sample.match(new RegExp('#ext-x-media-sequence:0[^0-9]'))) return true
		let pe = sample.indexOf('#ext-x-endlist')
		let px = sample.lastIndexOf('#extinf')
		if(pe != -1){
			return pe > px
		}
		if(sample.indexOf('#ext-x-program-date-time') == -1){
			let pieces = sample.split('#extinf')
			if(pieces.length > 30){
				return true
			}
			if(typeof(contentLength) == 'number' && pieces.length > 2){ //  at least 3 pieces, to ensure that the first extinf is complete
				let header = pieces.shift()
				let pieceLen = pieces[0].length + 7
				let totalEstimatedPieces = (contentLength - header.length) / pieceLen
				if(totalEstimatedPieces > 30){
					return true
				}
			}
		}
	}
	scope.listNameFromURL = url => {
		let name
		if (url.indexOf('?') !== -1) {
			url.split('?')[1].split('&').forEach(s => {
				s = s.split('=')
				if (s.length > 1) {
					if (['name', 'dn', 'title'].includes(s[0])) {
						if (!name || name.length < s[1].length) {
							name = s[1]
						}
					}
				}
			})
		}
		if(!name && url.indexOf('@') != -1) {
			const m = url.match(new RegExp('//([^:]+):[^@]+@([^/#]+)'))
			if(m) {
				name = m[2] +' '+ m[1]
			}
		}
		if (name) {
			name = scope.decodeURIComponentSafe(name)
			if (name.indexOf(' ') === -1 && name.indexOf('+') !== -1) {
				name = name.replaceAll('+', ' ').replaceAll('<', '').replaceAll('>', '')
			}
			return name
		}
        if(url.indexOf('//') == -1){ // isLocal
            return url.split('/').pop().replace(new RegExp('\\.[A-Za-z0-9]{2,4}$', 'i'), '')
        } else {
            url = String(url).replace(new RegExp('^[a-z]*://', 'i'), '').split('/').filter(s => s.length)
            if(!url.length){
                return 'Untitled '+ parseInt(Math.random() * 9999)
            } else if(url.length == 1) {
                return url[0]
            } else {
                return (url[0].split('.')[0] + ' ' + url[url.length - 1]).replace(new RegExp('\\?.*$'), '')
            }
        }
	}
	scope.fileNameFromURL = (url, defaultExt = 'mp4') => {
		let filename = url.split('?')[0].split('/').filter(s => s).pop()
		if(!filename || filename.indexOf('=') != -1){
			filename = 'video'
		}
		if(filename.indexOf('.') == -1){
			filename += '.' + defaultExt
		}
		return scope.sanitize(filename)
	}
	scope.dirname = _path => {
		let parts = _path.replace(new RegExp('\\\\', 'g'), '/').split('/')
		parts.pop()
		return parts.join('/')
	}
    scope.parseJSON = json => { // prevent JSON related crashes
		let ret
		try {
			let parsed = JSON.parse(json)
			ret = parsed
		} catch(e) { }
		return ret
	}
	scope.sanitize = txt => {
		return txt.replace(new RegExp('[^A-Za-z0-9]+'), '')
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


