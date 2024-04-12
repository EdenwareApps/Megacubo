
class OSDSrv {
    constructor(){
    }
    show(text, icon, name, time){
        console.log('osd-show', text)
        global.renderer.emit('osd-show', text, icon, name, time)
    }
    hide(name){
        global.renderer.emit('osd-hide', name)
    }
}

module.exports = OSDSrv
