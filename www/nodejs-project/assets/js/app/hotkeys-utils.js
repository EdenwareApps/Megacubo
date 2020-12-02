
function menuPlayingEnter(){
    body.addClass('menu-playing')
    explorer.overScrollAction = menuPlayingLeave
    explorer.reset()
}

function menuPlayingAllow(){
    return false
}

function menuPlayingLeave(){
    body.removeClass('menu-playing')
    explorer.overScrollAction = null
    setTimeout(explorer.reset.bind(explorer), 400)
}

function escapePressed(){
    console.log('Escape pressed')
    if(explorer.inModal()) {
        if(!explorer.inModalMandatory()){
            explorer.endModal()
        }
    } else {
        let playing = explorer.inPlayer(), exploring = playing && explorer.isExploring()
        if(playing && !exploring){
            if(arePlayerControlsVisible()){
                // menuPlayingLeave()
                idleStart()
                idleLock(1)
            } else {
                streamer.stop()
            }
        } else {
            if(explorer.path){
                app.emit('explorer-back')
            } else {
                if(playing){
                    // menuPlayingLeave()
                    idleStart()
                } else {
                    askExit()
                }
            }
        }
    }
}

function arePlayerControlsVisible(){
    return [0, '0', '0px'].indexOf(jQuery(streamer.controls).css('bottom')) != -1
}

function arrowUpPressed(){
    if(!explorer.inModal() && explorer.inPlayer() && !explorer.isExploring()){
        if(menuPlayingAllow() && arePlayerControlsVisible()){
            menuPlayingEnter()
        } else {
            menuPlayingLeave()
            body.removeClass('idle')
        }
    } else {
        explorer.arrow('up')
    }
}

function arrowDownPressed(){
    if(!explorer.inModal() && explorer.inPlayer() && !explorer.isExploring()){
        menuPlayingLeave()
        body.addClass('idle')
    } else {
        explorer.arrow('down')
    }
}

var shortcuts = [];
function createShortcut(key, callback, type, enableInInput){
    key = key.replaceAll(' ', ',');
    return $.Shortcuts.add({
        type: type ? type : 'down',
        mask: key,
        enableInInput: !!enableInInput,
        handler: () => {
            console.log(key+' pressed', document.URL)
            callback.call(window.top)
        }
    })
}

function setupShortcuts(){ 
    if(typeof(config.hotkeys) == 'object' && typeof(hotkeysActions)=='object'){
        for(let key in config.hotkeys){
            if(Array.isArray(hotkeysActions[config.hotkeys[key]])){
                key.split(' ').forEach(k => {
                    let args = hotkeysActions[config.hotkeys[key]].slice(0)
                    args.unshift(k)
                    shortcuts.push(createShortcut.apply(createShortcut, args))
                })
            }
        }
        $.Shortcuts.start()
    } else {
        console.error('Error loading hotkey\'s actions.')
    }
}

function getActionHotkey(action, nowrap) {
    if(typeof(hotkeysActions) != 'undefined' && typeof(hotkeysActions[action]) == 'string'){
        if(nowrap) {
            return hotkeysActions[action][0]
        }
        return ' (' + hotkeysActions[action][0] + ')'
    }
    return ''
}