import renderer from '../bridge/bridge.js'
import { EventEmitter } from 'node:events'

class OSD extends EventEmitter {
    constructor() {
        super()
    }
    show(text, icon, name, time) {
        renderer.ui.emit('osd-show', text, icon, name, time)
        this.emit('show', text, icon, name, time)
    }
    hide(name) {
        renderer.ui.emit('osd-hide', name);
        this.emit('hide', name)
    }
}

export default new OSD()
