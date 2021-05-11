const Events = require('events')

class Energy extends Events {
    constructor(){
		super()
    }
    restart(){
		global.ui.emit('restart')
	}
    exit(){
		global.ui.emit('exit')
	}
	askExit(){
		global.ui.emit('ask-exit')
	}
}

module.exports = Energy
