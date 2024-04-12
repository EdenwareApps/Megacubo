const { EventEmitter } = require('events')

class Energy extends EventEmitter {
    constructor(){
		super()
    }
    restart(){
		global.renderer.emit('restart')
	}
    exit(){
		console.error('ENERGY_EXIT='+ global.traceback())
		global.renderer.emit('exit', false)
	}
	askRestart(){
		global.renderer.emit('ask-restart')
	}
	askExit(){
		global.renderer.emit('ask-exit')
	}
}

module.exports = new Energy()
