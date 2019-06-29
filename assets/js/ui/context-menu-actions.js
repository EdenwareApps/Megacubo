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
            getPreviousStream(null, (e) => {
                if(e){
                    (top || parent).playEntry(e)
                } else {
                    (top || parent).stop()
                    notify(Lang.NOT_FOUND, 'fa-ban', 'normal')
                }
            })
        }
    ],
    "PLAYNEXT": [
        () => {
            getNextStream(null, (e) => {
                if(e){
                    (top || parent).playEntry(e)
                } else {
                    (top || parent).stop()
                    notify(Lang.NOT_FOUND, 'fa-ban', 'normal')
                }
            })
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