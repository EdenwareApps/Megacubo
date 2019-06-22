window.contextMenuActions = {
    "TVGUIDE": [
        () => {
            openTVGuide()
        }
    ],
    "DUPLICATE": [
        () => {
            spawnOut()
        }
    ],
    "STOP": [
        () => {
            stop()
        }
    ],
    "SEARCH": [
        () => {
            goSearch(false)
        }
    ],
    "RELOAD": [
        () => {
            goReload()
        }
    ],
    "SOFTRELOAD": [
        () => {
            if(Playback.active && Playback.active.type != 'html'){
				getFrame('player').reset()
			}
        }
    ],
    "PLAYPAUSE": [
        () => {
            playPause()
        }
    ],
    "HISTORY": [
        () => {
            goHistory()
        }
    ],
    "OPENURLORLIST": [
        () => {
            addNewSource(false, false, true)
        }
    ],
    "CHANGELANG": [
        () => {
            goChangeLang()
        }
    ],
    "BOOKMARKS": [
        () => {
            goBookmarks()
        }
    ],
    "RESTARTAPP": [
        () => {
            restartApp()
        }
    ],
    "TOOLS": [
        () => {
            if(!Menu.isVisible()){
                Menu.show()
            }
            Menu.go(Lang.TOOLS)
        }
    ],
    "HOME": [
        () => {
            if(!Menu.isVisible()){
                Menu.show()
            }
            Menu.go('')
        }
    ],
    "FULLSCREEN": [
        () => {
                toggleFullScreen()
            }
    ],
    "SEEKFORWARD": [
        () => {
                seekForward()
            }, "hold"
    ],
    "PLAYPREVIOUS": [
        () => {
                var s = getPreviousStream();
                if(s){
                    console.log(s);
                    playEntry(s)
                }
            }
    ],
    "PLAYNEXT": [
            () => {
                var s = getNextStream();
                if(s){
                    console.log(s);
                    playEntry(s)
                }
            }
    ],
    "CHANGESCALE": [
        () => {
                changeScaleMode()
            }
    ],
    "MINIPLAYER": [
        () => {
            toggleMiniPlayer() // global shortcuts fail sometimes, so list it here too as a fallback hotkey binding
        }
    ],
    "PLAYALTERNATE": [
        () => {
            if(!alternateStream(false, false, false)){
                goReload()
            }
        }
    ],
    "ABOUT": [
        () => {
            about()
        }
    ],
    "EXIT": [
        () => {
            closeApp(true)
        }
    ]
}