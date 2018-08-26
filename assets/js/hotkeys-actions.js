var hotkeysActions = {
    "DUPLICATE": [
        () => {
            spawnOut()
        },
        null, 
        true
    ],
    "STOP": [
        () => {
                stop()
        },
        null,
        true
    ],
    "OPEN": [
        () => {
          openFileDialog(function (file){
                var o = getFrame('overlay');
                if(o){
                    o.processFile(file)
                }
            })
        }, 
        null, 
        true
    ],
    "UNDO": [
        () => {
            playPrevious()
        }, 
        null, 
        true
    ],
    "HELP": [
        help
    ],
    "RENAME": [
        () => {
            renameSelectedEntry()
        }, 
        null, 
        true
    ],
    "SEARCH": [
        () => {
            goSearch()
        }, 
        null, 
        true
    ],
    "RELOAD": [
        () => {
            goReload()
        }, 
        null, 
        true
    ],
    "SOFTRELOAD": [
        () => {
            if(PlaybackManager.activeIntent && PlaybackManager.activeIntent.type != 'frame'){
				getFrame('player').reset()
			}
        }, 
        null, 
        true
    ],
    "PLAYPAUSE": [
        () => {
            playPause()
        }
    ],
    "HISTORY": [
        () => {
            goHistory()
        }, 
        null, 
        true
    ],
    "ADDNEWSOURCE": [
        () => {
            addNewSource()
        }, 
        null, 
        true
    ],
    "CHANGELANG": [
        () => {
            goChangeLang()
        }
    ],
    "ADDFAV": [
        () => {
            addFav();
            Menu.refresh()
        }, 
        null, 
        true
    ],
    "REMOVEFAV": [
        () => {
            removeFav();
            Menu.refresh()
        }, 
        null, 
        true
    ],
    "BOOKMARKS": [
        () => {
            goBookmarks()
        }, null, true
    ],
    "RESTARTAPP": [
        () => {
            restartApp()
        }, null, true
    ],
    "HOME": [
        () => {
            if(!areControlsActive()){
                showControls()
            }
            Menu.go('')
        }
    ],
    "DELETE": [
        () => {
            if(areControlsActive()){
                Menu.triggerKey('delete')
            } else {
                if(!areControlsHiding()){
                    stop();
                    notify(Lang.STOP, 'fa-stop', 'short')
                }
            }
        }
    ],
    "NAVUP": [
        () => {
            showControls();
            Menu.focusPrevious()
        }, "hold", true
    ],
    "NAVDOWN": [
        () => {
                showControls();
                Menu.focusNext()
            }, "hold", true
    ],
    "NAVENTER": [
        () => {
                if(!isMiniPlayerActive()){
                    if(!areControlsActive()){
                        showControls()
                    } else {
                        Menu.enter()
                    }
                }
            }
    ],
    "FULLLSCREEN": [
        () => {
                toggleFullScreen()
            }
    ],
    "SEEKFORWARD": [
        () => {
                seekForward()
            }, "hold"
    ],
    "SEEKREWIND": [
        () => {
                seekRewind()
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
    "BACKNOTINPUT": [
        () => {
                backSpacePressed()
            }, "hold"
    ],
    "BACK": [
        () => { // with Ctrl it work on inputs so
                backSpacePressed()
            }, null, true
    ],
    "CHANGESCALE": [
        () => {
                changeScaleMode()
            }
    ],
    "MINIPLAYER": [
        () => {
                toggleMiniPlayer() // global shortcuts fail sometimes, so list it here too as a fallback hotkey binding
            }, null, true
    ],
    "PLAYALTERNATE": [
            () => {
                if(!isStopped()){
                    switchPlayingStream()
                } else {
                    playPrevious()
                }
            }, null, true
    ],
    "ESCAPE": [
        () => {
                escapePressed()
            }, null, true
    ]
}