function patch(scope){
	if (!scope.String.prototype.format) {
		scope.String.prototype.format = function (){
			var args = arguments;
			return this.replace(/{(\d+)}/g, function(match, number) {
			return typeof args[number] != 'undefined'
				? args[number]
				: match
			})
		}
	}
	if (!scope.String.prototype.matchAll) {
		scope.String.prototype.matchAll = function(regexp) {
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
	}	
	if (!scope.Array.prototype.sortByProp) {
		scope.Array.prototype.sortByProp = function (p, reverse) {
			if(Array.isArray(this)){ // this.slice is not a function
				return this.slice(0).sort((a,b) => {
					let ua = typeof(a[p]) == 'undefined', ub = typeof(b[p]) == 'undefined'
					if(ua && ub) return 0
					if(ua && !ub) return reverse ? 1 : -1
					if(!ua && ub) return reverse ? -1 : 1
					if(reverse) return (a[p] > b[p]) ? -1 : (a[p] < b[p]) ? 1 : 0;
					return (a[p] > b[p]) ? 1 : (a[p] < b[p]) ? -1 : 0;
				})
			}
			return this;
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
	if(typeof(require) == 'function'){
		if(typeof(scope.URLSearchParams) == 'undefined'){ // node
			scope.URLSearchParams = require('url-search-params-polyfill')
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
    scope.ucWords = str => {
        return str.replace(new RegExp('(^|[ ])[A-zÀ-ú]', 'g'), (letra) => {
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
	scope.Number.prototype.between = function(a, b) {
		var min = Math.min(a, b), max = Math.max(a, b)
		return this >= min && this <= max
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
	scope.String.prototype.replaceAll = function(search, replacement) {
		let target = this
		if(target.indexOf(search)!=-1){
			target = target.split(search).join(replacement)
		}
		return String(target)
	} 	
	scope.forwardSlashes = (file) => {
		return file.replaceAll('\\', '/').replaceAll('//', '/')
	}
	scope.time = () => {
		return ((new Date()).getTime() / 1000)
	}
	scope.isVODM3U8 = content => {
        let sample = String(content).toLowerCase()
        return sample.indexOf('#ext-x-playlist-type:vod') != -1 || sample.indexOf('#ext-x-endlist') != -1
	}
	scope.filenameFromURL = (url, defaultExt = 'mp4') => {
		let filename = url.split('?')[0].split('/').filter(s => s).pop()
		if(!filename || filename.indexOf('=') != -1){
			filename = 'video'
		}
		if(filename.indexOf('.') == -1){
			filename += '.' + defaultExt
		}
		return scope.sanitize(filename)
	}
	scope.isWritable = stream => {
		return stream.writable || stream.writeable
	}
    scope.isNetworkIP = addr => {
        if(addr){
			if(addr.startsWith('10.') || addr.startsWith('172.') || addr.startsWith('192.')){
				return 'ipv4'
			}
		}
    }
	scope.execSync = cmd => {
		let stdout
		try {
			stdout = require('child_process').execSync(cmd)
		} catch(e) {
			stdout = String(e)
		}
		return String(stdout)
	}
	scope.androidSDKVer = () => {
		if(!scope.androidSDKVerCache){
			scope.androidSDKVerCache = parseInt(scope.execSync('getprop ro.build.version.sdk').trim())
		}
		return scope.androidSDKVerCache
	}	
	scope.os = () => {
		if(!scope.osCache){
			scope.osCache = require('os')
		}
		return scope.osCache
	}
	scope.networkIpCache = false
	scope.networkIpCacheTTL = 10
	scope.networkDummyInterfaces = addr => {
		return {
			"Wi-Fi": [
				{
					"address": addr,
					"netmask": "255.255.255.0",
					"family": "IPv4",
					"mac": "00:00:00:00:00:00",
					"internal": false
				}
			],
			"Loopback Pseudo-Interface 1": [
				{
					"address": "127.0.0.1",
					"netmask": "255.0.0.0",
					"family": "IPv4",
					"mac": "00:00:00:00:00:00",
					"internal": true,
					"cidr": "127.0.0.1/8"
				}
			]
		}
	}
	scope.androidIPCommand = () => {
		return scope.execSync('ip route get 8.8.8.8')
	}
	scope.networkInterfaces = () => {
		if(process.platform == 'android'){
			let sdkVer = scope.androidSDKVer()
			if(isNaN(sdkVer) || sdkVer < 20 || sdkVer >= 29){ // keep "sdkVer < x" check
				// on most recent sdks, os.networkInterces() crashes nodejs-mobile-cordova with a uv_interface_addresses error
				let addr, time = scope.time()
				if(scope.networkIpCache && (scope.networkIpCache.time + scope.networkIpCacheTTL) > time){
					addr = scope.networkIpCache.addr
				} else {
					addr = scope.androidIPCommand().match(new RegExp('src +([0-9\.]+)'))
					if(addr){
						addr = addr[1]
						scope.networkIpCache = {addr, time}
					} else {
						addr = scope.networkIpCache ? scope.networkIpCache.addr : '127.0.0.1'
					}
				}
				return scope.networkDummyInterfaces(addr)
			}
		}
		return scope.os().networkInterfaces()
	}
    scope.networkIP = () => {
		let interfaces = scope.networkInterfaces(), addr = '127.0.0.1', skipIfs = new RegExp('(vmware|virtualbox)', 'i')
		for (let devName in interfaces) {
			if(devName.match(skipIfs)) continue
			let iface = interfaces[devName]
			for (let i = 0; i < iface.length; i++) {
				let alias = iface[i]
				if (alias.family === 'IPv4' && !alias.internal && scope.isNetworkIP(alias.address)){
					addr = alias.address
				}
			}
		}
		return addr
	}
}

if(typeof(module) != 'undefined' && typeof(module.exports) != 'undefined'){
	module.exports = patch
} else {
	patch(window)
}


