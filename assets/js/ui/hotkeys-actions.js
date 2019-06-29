var hotkeysActions = {
    "TVGUIDE": [
        () => {
            if(!isModal()){
                openTVGuide()
            }
        },
        null, 
        true
    ],
    "DUPLICATE": [
        () => {
            if(!isModal()){
                spawnOut()
            }
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
            if(!isModal()){
                openFileDialog(function (file){
                    var o = getFrame('overlay');
                    if(o){
                        o.processFile(file)
                    }
                })
            }
        }, 
        null, 
        true
    ],
    "UNDO": [
        () => {
            if(!isModal()){
                playPrevious()
            }
        }, 
        null, 
        true
    ],
    "ABOUT": [
        about
    ],
    "RENAME": [
        () => {
            if(!isModal()){
                Menu.renameSelected()
            }
        }, 
        null, 
        true
    ],
    "SEARCH": [
        () => {
            if(!isModal()){
                goSearch(false, lastSearchType || 'all')
            }
        }, 
        null, 
        true
    ],
    "RELOAD": [
        () => {
            if(!isModal()){
                goReload()
            }
        }, 
        null, 
        true
    ],
    "SOFTRELOAD": [
        () => {
            if(Playback.active && Playback.active.type != 'html'){
                getFrame('player').reset()
            }
        }, 
        null, 
        true
    ],
    "PLAYPAUSE": [
        () => {
            if(!isModal()){
                playPause()
            }
        }
    ],
    "HISTORY": [
        () => {
            if(!isModal()){
                goHistory()
            }
        }, 
        null, 
        true
    ],
    "OPENURLORLIST": [
        () => {
            if(!isModal()){
                addNewSource(false, false, true)
            }
        }, 
        null, 
        true
    ],
    "PASTEPLAY": [
        () => {
            if(!isModal()){
                var cb = top.clipboard.get('text');
                if(cb){
                    cb = cb.trim(cb);
                        if(cb.match(new RegExp('^(//|(https?|rtmp)://)'))){
                        return playCustomURL(cb, true)
                    }
                }
                addNewSource(false, false, true)	
            }		
        }, 
        null, 
        false
    ],
    "CHANGELANG": [
        () => {
            if(!isModal()){
                goChangeLang()
            }
        }
    ],
    "ADDFAV": [
        () => {
            if(!isModal()){
                addFav()
                Menu.refresh()
            }
        }, 
        null, 
        true
    ],
    "REMOVEFAV": [
        () => {
            if(!isModal()){
                removeFav()
                Menu.refresh()
            }
        }, 
        null, 
        true
    ],
    "BOOKMARKS": [
        () => {
            if(!isModal()){
                goBookmarks()
            }
        }, null, true
    ],
    "RESTARTAPP": [
        () => {
            restartApp(true)
        }, null, true
    ],
    "HOME": [
        () => {
            if(!isModal()){
                if(!Menu.isVisible()){
                    Menu.show()
                }
                Menu.go('')
            }
        }
    ],
    "DELETE": [
        () => {
            if(!isModal()){
                if(Menu.isVisible()){
                    Menu.triggerKey('delete')
                } else {
                    if(!isMenuHiding()){
                        stop()
                        notify(Lang.STOP, 'fa-stop', 'short')
                    }
                }
            }
        }
    ],
    "NAVUP": [
        () => {
            Pointer.arrow('up')
        }, "hold", true
    ],
    "NAVDOWN": [
        () => {
            if(typeof(Pointer)==='undefined'){
                throw ('Error: ' + document.URL)
            }
            Pointer.arrow('down')
        }, "hold", true
    ],
    "NAVRIGHT": [
        () => {
            Pointer.arrow('right')
        }, "hold", true
    ],
    "NAVLEFT": [
        () => {
            Pointer.arrow('left')
        }, "hold", true
    ],
    "NAVENTER": [
        () => {
            var e;
            if(e = Pointer.selected(false, true)){
                if(!isMiniPlayerActive()){
                    if(!Menu.isVisible()){
                        Menu.show()
                    } else {
                        Menu.enter()
                    }
                }
            } else if(e = Pointer.selected(false)) {
                e.click()
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
            if(!isModal()){
                seekForward()
            }
        }, "hold"
    ],
    "SEEKREWIND": [
        () => {
            if(!isModal()){
                seekRewind()
            }
        }, "hold"
    ],
    "PLAYPREVIOUS": [
        () => {
            if(!isModal()){
                getPreviousStream(null, (e) => {
                    if(e){
                        (top || parent).playEntry(e)
                    } else {
                        (top || parent).stop()
                        notify(Lang.NOT_FOUND, 'fa-ban', 'normal')
                    }
                })
            }
        }
    ],
    "PLAYNEXT": [
        () => {
            if(!isModal()){
                getNextStream(null, (e) => {
                    if(e){
                        (top || parent).playEntry(e)
                    } else {
                        (top || parent).stop()
                        notify(Lang.NOT_FOUND, 'fa-ban', 'normal')
                    }
                })
            }
        }
    ],
    "BACKNOTINPUT": [
        () => {
            if(!isModal()){
                backSpacePressed()
            }
        }, "hold"
    ],
    "BACK": [
        () => { // with Ctrl it work on inputs so
            if(!isModal()){
                backSpacePressed()
            }
        }, null, true
    ],
    "CHANGESCALE": [
        () => {
            if(!isModal()){
                changeScaleMode()
            }
        }
    ],
    "MINIPLAYER": [
        () => {
            if(!isModal() || isMiniPlayerActive()){
                toggleMiniPlayer() // global shortcuts fail sometimes, so list it here too as a fallback hotkey binding
            }
        }, null, true
    ],
    "PLAYALTERNATE": [
        () => {
            if(!isModal()){
                if(!alternateStream(false, false, false)){
                    goReload()
                }
            }
        }, null, true
    ],
    "ESCAPE": [
        () => {
            escapePressed()
        }, null, true
    ]
}