var uiSounds = [], uiSoundsEnable = true

function soundSetup(tag, vol){
    uiSounds[tag] = new buzz.sound('assets/sounds/'+ tag, {
        formats: [ 'mp3' ],
        volume: vol
    })
}

function sound(tag, vol){
    if(typeof(buzz) != 'undefined'){
        if(uiSoundsEnable && parent.player.state != 'playing'){
            if(!vol){
                vol = 100
            }
            if(typeof(uiSounds[tag]) == 'undefined'){
                soundSetup(tag, vol)
            }
            if(config && typeof(config['volume']) == 'number'){
                vol *= (config['volume'] / 100)
            }
            if(vol){ // lazily for sooner playback
                uiSounds[tag].stop().play()
                if(uiSounds[tag].getVolume() != vol){
                    uiSounds[tag].setVolume(vol)
                }
            }
            if(parent.cordova && parent.parent.navigator && parent.parent.navigator.vibrate){
                parent.parent.navigator.vibrate(25)
            }
        }
    }
}
