const paths = global.paths || {}

if(!global.paths) {
	const fs = require('fs'), path = require('path')
	const forwardSlashes = path => path.replace(new RegExp('\\\\', 'g'), '/')
	const checkDirWritePermissionSync = dir => {
		let fine
		const file = dir +'/temp.txt'
		try {
			fs.writeFileSync(file, '0')
			fine = true
			fs.unlinkSync(file)
		} catch(e) {
			console.error(e)
		}
		return fine
	}

	paths.cwd = String(path.join(__dirname, '../../') || process.cwd()).replace(new RegExp('\\\\', 'g'), '/')
	paths.manifest = require(paths.cwd + '/package.json')

	try {
		paths.cordova = require.resolve('cordova-bridge') ? require('cordova-bridge') : false
	} catch(e) {
		paths.cordova = false
	}

	if(paths.cordova){
		const datadir = paths.cordova.app.datadir()
		const temp = path.join(path.dirname(datadir), 'cache')
		Object.assign(paths, {data: datadir +'/Data', temp})
	} else {
		if(fs.existsSync(paths.cwd +'/.portable') && checkDirWritePermissionSync(paths.cwd +'/.portable')) {
			Object.assign(paths, {data: paths.cwd +'/.portable/Data', temp: paths.cwd +'/.portable/temp'})
		} else {
			Object.assign(paths, require('env-paths')(paths.manifest.window.title, {suffix: ''}))
		}
	}

	Object.keys(paths).forEach(type => {
		if(typeof(paths[type]) != 'string') return
		paths[type] = forwardSlashes(paths[type])
		if(paths[type].endsWith('/')) {
			paths[type] = paths[type].substr(0, paths[type].length - 1)
		}
		console.log('DEFAULT PATH ' + type + '=' + paths[type] +' '+ global.inWorker +' :: '+ !!paths.cordova)
		if(!fs.existsSync(paths[type])) {
			try {
				fs.mkdirSync(paths[type], {recursive: true})
			} catch(e) {}
		}
	})
	global.paths = paths
}

module.exports = paths