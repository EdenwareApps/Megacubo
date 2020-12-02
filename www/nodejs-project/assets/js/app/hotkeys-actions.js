var hotkeysActions = {
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
            explorer.triggerAction(lang.CATEGORIES + '/' + lang.SEARCH, lang.SEARCH).catch(console.error)
        }, "up", true
    ],
    "OPENURL": [
        () => {
            explorer.triggerAction(lang.TOOLS, lang.OPEN_URL).catch(console.error)
        }, "up", true
    ],
    "ABOUT": [
        () => {
            app.emit('about')
        }, "up", true
    ]
}