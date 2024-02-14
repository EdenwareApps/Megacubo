
class OSDSrv {
    constructor(){
    }
    show(text, icon, name, time){
        console.log('osd-show', text)
        global.ui.emit('osd-show', text, icon, name, time)
    }
    hide(name){
        global.ui.emit('osd-hide', name)
    }
}

module.exports = OSDSrv
