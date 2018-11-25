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
            goSearch(false, '')
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
    "PASTEPLAY": [
        () => {
		var cb = top.clipboard.get('text');
		if(cb){
			cb = cb.trim(cb);
		        if(cb.match(new RegExp('^(//|(https?|rtmp)://)'))){
				return playCustomURL(cb, true)
			}
		}
            	addNewSource()			
        }, 
        null, 
        false
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
            if(!isMenuVisible()){
                showMenu()
            }
            Menu.go('')
        }
    ],
    "DELETE": [
        () => {
            if(isMenuVisible()){
                Menu.triggerKey('delete')
            } else {
                if(!isMenuHiding()){
                    stop();
                    notify(Lang.STOP, 'fa-stop', 'short')
                }
            }
        }
    ],
    "NAVUP": [
        () => {
            showMenu();
            Menu.focusPrevious()
        }, "hold", true
    ],
    "NAVDOWN": [
        () => {
                showMenu();
                Menu.focusNext()
            }, "hold", true
    ],
    "NAVENTER": [
        () => {
                if(!isMiniPlayerActive()){
                    if(!isMenuVisible()){
                        showMenu()
                    } else {
                        Menu.enter()
                    }
                }
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