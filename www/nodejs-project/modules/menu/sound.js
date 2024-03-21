import 'buzz'

export class Sounds {
    constructor() {
        this.sounds = []
        this.enabled = true
        this.volume = 100
    }
    setup(tag, vol){
        this.sounds[tag] = new buzz.sound('assets/sounds/'+ tag, {
            formats: [ 'mp3' ],
            volume: vol
        })
    }
    play(tag, vol){
        if(typeof(buzz) != 'undefined'){
            if(this.enabled && player.state != 'playing'){
                if(!vol){
                    vol = 100
                }
                if(typeof(this.sounds[tag]) == 'undefined'){
                    this.setup(tag, vol)
                }
                vol *= this.volume / 100
                if(vol){ // lazily for sooner playback
                    this.sounds[tag].stop().play()
                    if(this.sounds[tag].getVolume() != vol){
                        this.sounds[tag].setVolume(vol)
                    }
                }
                if(window.cordova && navigator && navigator.vibrate){
                    navigator.vibrate(25)
                }
            }
        }
    }
}
