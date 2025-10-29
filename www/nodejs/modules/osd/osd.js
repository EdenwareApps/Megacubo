import renderer from '../bridge/bridge.js'
import { EventEmitter } from 'node:events'
import { traceback } from '../utils/utils.js'

class OSD extends EventEmitter {
    constructor() {
        super()
    }
    show(text, icon, name, time) {
        if(icon && icon.includes('exclamation')) {
            console.error('OSD.show', text, icon, name, time, traceback())
        }
        if (renderer.ui && typeof renderer.ui.emit === 'function') {
            renderer.ui.emit('osd-show', text, icon, name, time)
        }
        this.emit('show', text, icon, name, time)
    }
    hide(name) {
        if (renderer.ui && typeof renderer.ui.emit === 'function') {
            renderer.ui.emit('osd-hide', name);
        }
        this.emit('hide', name)
    }
}

export default new OSD()
