const Events = require('events'), path = require('path')

class Energy extends Events {
    constructor(){
		super()
    }
    restart(){
		let delay = 400
		this.emit('restart')
		this.emit('exit')
		if(!global.cordova && typeof(nw) == 'undefined'){
			const child = require('child_process')
			let argv = [...new Set(process.execArgv.concat(process.argv.slice(1)))]
			child.spawn(process.argv[0], argv, {
				detached : true,
				stdio: 'inherit'
			}).unref()
			console.log('PREPARE TO EXIT')
			process.nextTick(() => {
				console.log('EXITING')
				process.exit()
			})
		}
		// on cordova or nw.js, node will be restarted by ui
    }
    exit(){
		console.log('energy exit()')
		this.emit('exit')
		process.exit()
    }
}

class UIEnergy extends Energy {
	constructor(){
		super()
		this.on('restart', this.uiRestart.bind(this))
	}
	uiRestart(){
		global.ui.emit('restart')
	}
	uiExit(){
		global.ui.emit('exit')
	}
	askExit(){
		global.ui.emit('ask-exit')
	}
}

module.exports = UIEnergy

