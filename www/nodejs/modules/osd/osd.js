import renderer from '../bridge/bridge.js'
class OSD {
    constructor() {}
    show(text, icon, name, time) {
        console.log('osd-show', text);
        renderer.get().emit('osd-show', text, icon, name, time);
    }
    hide(name) {
        renderer.get().emit('osd-hide', name);
    }
}
export default new OSD()
