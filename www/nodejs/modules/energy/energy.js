import { EventEmitter } from 'events';
import renderer from '../bridge/bridge.js'

class Energy extends EventEmitter {
    constructor() {
        super();
    }
    restart() {
        renderer.get().emit('restart');
    }
    exit() {
        console.error('ENERGY_EXIT')
        renderer.get().emit('exit', false)
    }
    askRestart() {
        renderer.get().emit('ask-restart')
    }
    askExit() {
        renderer.get().emit('ask-exit')
    }
}
export default new Energy()
