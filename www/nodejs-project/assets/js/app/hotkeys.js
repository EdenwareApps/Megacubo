

function arePlayerControlsVisible(){
    return [0, '0', '0px'].indexOf(jQuery(streamer.controls).css('bottom')) != -1
}

function menuPlaying(enable, ignoreFocus){
    if(enable){
        explorer.body.addClass('menu-playing')
        if(!ignoreFocus) {
            setTimeout(() => {
                explorer.updateSelection() || explorer.reset()
            }, 100)
        }
    } else {
        explorer.body.removeClass('menu-playing')
        idle.reset()
        idle.lock(0.1)
    }
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
            if(streamer.state == 'playing' && !streamer.casting && arePlayerControlsVisible()){
                idle.start()
                idle.lock(1)
            } else {
                streamer.stop()
            }
        } else {
            if(explorer.path){
                app.emit('explorer-back')
            } else {
                if(playing){
                    idle.start()
                }
            }
        }
    }
}

function arrowUpPressed(noNav){
    let playing = explorer.inPlayer(), exploring = explorer.isExploring()
    if(!explorer.inModal() && playing && !exploring){
        if(!noNav && streamer.isVolumeButtonActive()){
            streamer.volumeUp(1)
        } else {
            idle.start()
            idle.lock(1)
        }
    } else {
        if(!noNav) explorer.arrow('up')
    }
}

function arrowDownPressed(noNav){
    if(!explorer.inModal() && explorer.inPlayer()){
        if(explorer.isExploring()){
            if(!noNav) explorer.arrow('down')
        } else {
            if(!noNav && streamer.isVolumeButtonActive()){
                streamer.volumeDown(1)
            } else {
                if(idle.isIdle) {
                    idle.reset()
                } else if(noNav) {
                    explorer.body.addClass('menu-playing')
                } else {
                    if(!noNav) explorer.arrow('down')
                }
            }
        }
    } else {
        let s = explorer.selected()
        if(s && s.tagName.toLowerCase() == 'input' && s.id && s.id == 'explorer-omni-input'){
            explorer.focus(explorer.currentElements[explorer.selectedIndex])
        } else {
            if(!noNav) explorer.arrow('down')
        }
    }
}

function arrowRightPressed(noNav){
    let playing = explorer.inPlayer(), exploring = playing && explorer.isExploring()
    if(playing && !exploring){
        if(streamer.isSeeking){
            streamer.seekForward()
        } else if(idle.isIdle || noNav) {
            streamer.seekForward()
            idle.start()
            idle.lock(1)
        } else {
            if(!noNav) explorer.arrow('right')
        }
    } else {
        if(!noNav) explorer.arrow('right')
    }
}

function arrowLeftPressed(noNav){
    let playing = explorer.inPlayer(), exploring = playing && explorer.isExploring()
    if(playing && !exploring){
        if(streamer.isSeeking){
            streamer.seekRewind()
        } else if(idle.isIdle || noNav) {
            streamer.seekRewind()
            idle.start()
            idle.lock(1)
        } else {
            if(!noNav) explorer.arrow('left')
        }
    } else {
        if(!noNav) explorer.arrow('left')
    }
}

function enterPressed(){
    // ENTER PRESSED true true false <button class=​"menu selected">​…​</button>​ true false -1
    console.log('ENTER PRESSED', explorer.inPlayer(), explorer.isExploring(), arePlayerControlsVisible(), document.activeElement, streamer.active, idle.isIdle, document.body.className.indexOf('idle'))
    if(explorer.inPlayer()){
        let e = explorer.selected(false)
        if(e) {
            if(idle.isIdle){
                if(streamer.state != 'paused'){
                    console.log('ENTER IGNORED ON IDLE OUT', e)
                    return idle.reset()
                }
            }
            // e.click()
        }
    }
}

class Hotkeys {
    constructor(){
        this.shortcuts = []
    }
    create(key, callback, type, enableInInput){
        key = key.replaceAll(' ', ',')
        let params = {
            type: type ? type : 'down',
            mask: key,
            enableInInput: !!enableInInput,
            handler: () => {
                console.log(key+' pressed', document.URL)
                callback.call(window.top)
            }
        }
        $.Shortcuts.add(params)
        return params
    }
    start(hotkeys){ 
        this.end()
        console.log('hotkeys.start', traceback())
        if(typeof(hotkeys) == 'object' && typeof(hotkeysActions)=='object'){
            for(let key in hotkeys){
                if(Array.isArray(hotkeysActions[hotkeys[key]])){
                    key.split(' ').forEach(k => {
                        let args = hotkeysActions[hotkeys[key]].slice(0)
                        args.unshift(k)
                        this.shortcuts.push(this.create.apply(this, args))
                    })
                }
            }
            $.Shortcuts.start()
        } else {
            console.error('Error loading hotkey\'s actions.')
        }
    }
    end(){
        console.log('hotkeys.end', traceback())
        $.Shortcuts.stop()
        this.shortcuts.forEach(s => $.Shortcuts.remove(s))
    }
    getHotkeyAction(action, nowrap) {
        if(config['hotkeys']){
            let key = ''
            Object.keys(config['hotkeys']).forEach(k => {
                if(config['hotkeys'][k] == action){
                    key = k
                }
            })
            if(!key){
                return ''
            }
            if(nowrap) {
                return key
            }
            return ' (' + key + ')'
        }
        return ''
    }
}

