var uiSounds = []

function soundSetup(tag, vol){
    uiSounds[tag] = new buzz.sound('assets/sounds/'+ tag, {
        formats: [ 'mp3' ],
        volume: vol
    })
}

function sound(tag, vol){
    if(typeof(buzz) != 'undefined'){
        if(parent.player.state != 'playing'){
            if(!vol){
                vol = 100
            }
            if(typeof(uiSounds[tag]) == 'undefined'){
                soundSetup(tag, vol)
            }
            uiSounds[tag].stop().play()
            if(vol && uiSounds[tag].getVolume() != vol){ // lazily for sooner playback
                uiSounds[tag].setVolume(vol)
            }
        }
        if(parent.cordova && top.navigator && top.navigator.vibrate){
            top.navigator.vibrate(75)
        }
    }
}
