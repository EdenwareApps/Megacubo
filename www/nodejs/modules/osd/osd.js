import renderer from '../bridge/bridge.js'
import { traceback } from '../utils/utils.js';

class OSD {
    constructor() {}
    show(text, icon, name, time) {
        renderer.ui.emit('osd-show', text, icon, name, time)
    }
    hide(name) {
        renderer.ui.emit('osd-hide', name);
    }
}
export default new OSD()
