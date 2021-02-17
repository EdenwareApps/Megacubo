var hotkeysActions = {
    "HOME": [
        () => {
            if(explorer.scrollContainer.scrollTop()){
                explorer.scrollContainer.scrollTop(0)
            } else {
                explorer.triggerAction('').catch(console.error)
            }
        }, "up", true
    ],
    "PLAYPAUSE": [
        () => {
            if(explorer.inPlayer()){
                streamer.playOrPause()
            }
        }, "up"
    ],
    "BACKNOTINPUT": [
        () => {
            escapePressed()
        }, "hold"
    ],
    "BACK": [
        () => { // with Ctrl it work on inputs so
            // ...
        }, "up", true
    ],
    "ESCAPE": [
        () => {
            escapePressed()
        }, "up", true
    ],
    "NAVUP": [
        () => {
            arrowUpPressed()
        }
    ],
    "NAVDOWN": [
        () => {
            arrowDownPressed()
        }, "hold", true
    ],
    "NAVRIGHT": [
        () => {
            if(streamer.isSeeking && explorer.inPlayer()){
                streamer.seekFwd()
            } else {
                explorer.arrow('right')
            }
        }, "hold", false
    ],
    "NAVLEFT": [
        () => {
            if(streamer.isSeeking && explorer.inPlayer()){              
                streamer.seekBack()
            } else {
                explorer.arrow('left')
            }
        }, "hold", false
    ],
    "NAVENTER": [
        () => {
            // ENTER PRESSED true true false <button class=​"menu selected">​…​</button>​ true false -1
            console.log('ENTER PRESSED', explorer.inPlayer(), explorer.isExploring(), arePlayerControlsVisible(), document.activeElement, streamer.active, window.isIdle, document.body.className.indexOf('idle'))
            //if(document.activeElement == document.body){
                let e = explorer.selected(false)
                if(e) {
                    if(streamer.active && document.body.className.indexOf('idle') != -1){
                        if(streamer.state != 'paused'){
                            console.log('ENTER IGNORED ON IDLE OUT', e)
                            return idleStop()
                        }
                    }
                    // e.click()
                }
            //}
        }, "up"
    ],
    "SEARCH": [
        () => {
            omni.focus()
        }, "up", true
    ],
    "OPENURL": [
        () => {
            explorer.triggerAction(lang.TOOLS, lang.OPEN_URL).catch(console.error)
        }, "up", true
    ],
    "HISTORY": [
        () => {
            explorer.triggerAction(lang.TOOLS, lang.HISTORY).catch(console.error)
        }, "up", true
    ],
    "LANGUAGE": [
        () => {
            explorer.triggerAction(lang.OPTIONS, lang.LANGUAGE).catch(console.error)
        }, "up", true
    ],
    "FAV": [
        () => {
            app.emit('toggle-fav')
        }, "up", true
    ],
    "MINIPLAYER": [
        () => {
            parent.player.mini.toggle().catch(console.error)
        }, "up", true
    ],
    "RECORDING": [
        () => {
            app.emit('recording')
        }, "up", true
    ],
    "ABOUT": [
        () => {
            app.emit('about')
        }, "up", true
    ],
    'FULLSCREEN': [
        () => {
            if(top.Manager){
                top.Manager.toggleFullScreen()
                if(window.idleStop){
                    window.idleStop()
                }
            }
        }, "up", true
    ]
}