import { EventEmitter } from 'node:events';
import renderer from '../bridge/bridge.js'

class Energy extends EventEmitter {
    constructor() {
        super();
    }
    restart() {
        renderer.ui.emit('restart');
    }
    exit() {
        renderer.ui.emit('exit', false)
    }
    askRestart() {
        renderer.ui.emit('ask-restart')
    }
    askExit() {
        renderer.ui.emit('ask-exit')
    }
}
export default new Energy()
