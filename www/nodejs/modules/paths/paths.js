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

	paths.cwd = String(
		(__dirname.endsWith('app') || __dirname.endsWith('nodejs')) ? 
		__dirname : // is rollup bundle
		(__dirname.endsWith('paths') ? 
			path.join(__dirname, '../../') : 
			process.cwd()
		)).replace(new RegExp('\\\\', 'g'), '/');
	paths.manifest = require(paths.cwd + '/package.json')

	if(process.platform == 'android') {
		try {
			paths.android = require.resolve('bridge') ? require('bridge') : false
		} catch(e) {
			paths.android = false
		}
	}

	if(paths.android){
		const data = paths.android.getDataPath()
		const temp = data.indexOf('files') != -1 ? data.replace('files', 'cache') : require('os').tmpdir()
		Object.assign(paths, {data, temp})
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
		console.log('DEFAULT PATH ' + type + '=' + paths[type] +' '+ global.inWorker +' :: '+ !!paths.android)
		if(!fs.existsSync(paths[type])) {
			try {
				fs.mkdirSync(paths[type], {recursive: true})
			} catch(e) {}
		}
	})
	global.paths = paths
}

module.exports = paths