function patch(scope) {
	if(typeof(require) == 'function'){
		if(typeof(scope.URL) != 'undefined'){ // node
			scope.URL = require('url').URL
		}
		if(typeof(scope.URLSearchParams) == 'undefined'){ // node
			scope.URLSearchParams = require('url-search-params-polyfill')
		}
	}
	scope.DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS = 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Range, range, Authorization'
	scope.isWritable = stream => {
		return (stream.writable || stream.writeable) && !stream.finished
	}	
    scope.checkDirWritePermission = async dir => {
        const file = dir +'/temp.txt', fsp = scope.getFS().promises
        await fsp.writeFile(file, '0')
		await fsp.unlink(file)
		return true
    }
    scope.checkDirWritePermissionSync = dir => {
        let fine
		const file = dir +'/temp.txt', fs = scope.getFS()
        try {
			fs.writeFileSync(file, '0')
			fine = true
			fs.unlinkSync(file)
		} catch(e) {
			console.error(e)
		}
		return fine
    }
	scope.rmdir = (folder, itself, cb) => {
		const rimraf = require('rimraf')
		let dir = folder
		if(dir.charAt(dir.length - 1) == '/'){
			dir = dir.substr(0, dir.length - 1)
		}
		if(!itself){
			dir += '/*'
		}
		if(cb === true){ // sync
			try {
				rimraf.sync(dir)
			} catch(e) {}
		} else {
			try {
				rimraf(dir, cb || (() => {}))
			} catch(e) {
				if(typeof(cb) == 'function'){
					cb()
				}
			}
		}
	}
	scope.getFS = () => {
		if(!scope.__fs){
			scope.__fs = require('fs')
		}
		return scope.__fs
	}
	scope._moveFile = async (from, to) => {
		const fs = scope.getFS()
		const fstat = await fs.promises.stat(from).catch(console.error)
		if(!fstat) throw '"from" file not found'
		let err
		await fs.promises.rename(from, to).catch(e => err = e)
		if(err) {
			let err
			await fs.promises.copyFile(from, to).catch(e => err = e)
			if(typeof(err) != 'undefined'){
				const tstat = await fs.promises.stat(to).catch(console.error)
				if(tstat && tstat.size == fstat.size) err = null
			}
			if(err) throw err
			await fs.promises.unlink(from).catch(() => {})
		}
		return true
	}
	scope.moveFile = (from, to, _cb, timeout=5, until=null, startedAt = null, fromSize=null) => {
		const fs = scope.getFS(), now = scope.time(), cb = err => {
			if(_cb){
				_cb(err)
				_cb = null
			}
		}
		if(until === null){
			until = now + timeout
		}
		if(startedAt === null){
			startedAt = now
		}
		const move = () => {
			scope._moveFile(from, to).then(() => cb()).catch(err => {
				if(until <= now){
					fs.access(from, (aerr, stat) => {
						console.error('MOVERETRY GAVEUP AFTER '+ (now - startedAt) +' SECONDS', err, fromSize, aerr)
						return cb(err)
					})
					return
				}
				fs.stat(to, (ferr, stat) => {
					if(stat && stat.size == fromSize){
						cb()
					} else {
						fs.stat(from, (err, stat) => {
							if(stat && stat.size == fromSize){
								setTimeout(() => {
									scope.moveFile(from, to, cb, timeout, until, startedAt, fromSize)
								}, 500)
							} else {
								console.error('MOVERETRY FROM FILE WHICH DOESNT EXISTS ANYMORE', err, stat)
								console.error(ferr, err)
								cb(err || '"from" file changed')
							}
						})
					}
				})
			})
		}
		if(fromSize === null){
			fs.stat(from, (err, stat) => {
				if(err){
					console.error('MOVERETRY FROM FILE WHICH NEVER EXISTED', err)
					cb(err)
				} else {
					fromSize = stat.size
					move()
				}
			})
		} else {
			move()
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
    scope.isNetworkIP = addr => {
        if(addr){
			if(addr.startsWith('10.') || addr.startsWith('172.') || addr.startsWith('192.')){
				return 'ipv4'
			}
		}
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


