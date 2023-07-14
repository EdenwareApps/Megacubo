const Events = require('events')

class Energy extends Events {
    constructor(){
		super()
    }
    restart(){
		global.ui.emit('restart')
	}
    exit(){
		console.error('ENERGY_EXIT='+ global.traceback())
		global.ui.emit('exit', false)
	}
	askRestart(){
		global.ui.emit('ask-restart')
	}
	askExit(){
		global.ui.emit('ask-exit')
	}
}

module.exports = Energy
