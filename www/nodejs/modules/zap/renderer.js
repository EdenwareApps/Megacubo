import { main } from '../bridge/renderer'

export const zapSetup = streamer => {
    streamer.zappingIcon = 'fas fa-random'
    main.on('is-zapping', (state, skipOSD) => {
        streamer.isZapping = state
        if(state){
            if(skipOSD) {
                main.osd.hide('zap')
            } else {
                main.osd.hide('streamer')
                main.osd.show(main.lang.ZAPPING, streamer.zappingIcon, 'zap', 'persistent')
            }
        } else {
            main.osd.hide('zap')
        }
    })
    main.on('streamer-connect', () => {
        streamer.enablePlayerButton('zap', !!streamer.isZapping)
        streamer.enablePlayerButton('tune', !streamer.isZapping)
    })
}