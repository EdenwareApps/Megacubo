import renderer from '../bridge/bridge.js'
class OSD {
    constructor() {}
    show(text, icon, name, time) {
        console.log('osd-show', text);
        renderer.ui.emit('osd-show', text, icon, name, time);
    }
    hide(name) {
        renderer.ui.emit('osd-hide', name);
    }
}
export default new OSD()
