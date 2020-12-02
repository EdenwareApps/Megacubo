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

	if(typeof(scope.URLSearchParams) == 'undefined'){ // node
		scope.URLSearchParams = require('url-search-params-polyfill')
	} else { // browser
		scope.saveFileDialogChooser = false
		scope.saveFileDialog = function (callback, placeholder) {
			if(!saveFileDialogChooser){ // JIT
				saveFileDialogChooser = $('<input type="file" nwsaveas />')
			}
			if(placeholder){
				saveFileDialogChooser.prop('nwsaveas', placeholder)
			}
			saveFileDialogChooser.off('change')
			saveFileDialogChooser.val('')
			saveFileDialogChooser.on('change', (evt) => {
				callback(saveFileDialogChooser.val())
			});    
			saveFileDialogChooser.trigger('click')
		}
		scope.saveFolderDialogChooser = false
		scope.saveFolderDialog = function (callback, placeholder) {
			if(!saveFolderDialogChooser){ // JIT
				saveFolderDialogChooser = $('<input type="file" nwdirectory />');
			}
			if(placeholder){
				saveFolderDialogChooser.prop('nwdirectory', placeholder)
			}
			saveFolderDialogChooser.off('change')
			saveFolderDialogChooser.val('')
			saveFolderDialogChooser.on('change', (evt) => {
				callback(saveFolderDialogChooser.val())
			});    
			saveFolderDialogChooser.trigger('click')
		}
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
		return '#' + scope.componentToHex(r) + scope.componentToHex(g) + scope.componentToHex(b)
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

	return scope
}

if(typeof(module) != 'undefined' && typeof(module.exports) != 'undefined'){
	module.exports = patch
} else {
	patch(window)
}


