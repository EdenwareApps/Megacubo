if(typeof(themeRefresh) == 'undefined'){
    function colorChannelMixer(colorChannelA, colorChannelB, amountToMix){
        var channelA = colorChannelA*amountToMix
        var channelB = colorChannelB*(1-amountToMix)
        return parseInt(channelA+channelB)
    }
    function colorMixer(rgbA, rgbB, amountToMix){
        var r = colorChannelMixer(rgbA[0], rgbB[0], amountToMix)
        var g = colorChannelMixer(rgbA[1], rgbB[1], amountToMix)
        var b = colorChannelMixer(rgbA[2], rgbB[2], amountToMix)
        return "rgb("+r+","+g+","+b+")"
    }
    function themeRefresh(){
        const systemFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif'
        let family = config['font-family'], nfs = 0.0275 + (config['font-size'] * 0.0015)
        if(!family){
            family = systemFont
        } else if(family.indexOf(systemFont) == -1) {
            family += ','+ systemFont
        }
        let sbg = colorMixer(Object.values(hexToRgb(config['background-color'])), [0, 0, 0], 0.5)
        let mbg = hexToRGBA(config['background-color'], config['background-color-transparency'] / 100)
        let sfg = hexToRGBA(config['font-color'], 0.6)
        let fxNavIntensityStep = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--explorer-fx-nav-intensity-step').trim())
        let fxNavIntensity = config['fx-nav-intensity'] * fxNavIntensityStep
        let fxNavDuration
        if(!config['fx-nav-intensity']){
            fxNavDuration = 0
        } else {
            let min = 0.175, max = 1
            fxNavDuration = min + (config['fx-nav-intensity'] * ((max - min) / 10))
        }
        let radius = parent.parent.cordova ? '1vmax' : '9px'
        let cssCode = `
:root {
    --explorer-fx-nav-duration: ${fxNavDuration}s;
    --explorer-entry-name-font-size: calc(((100vmin + 100vmax) * 0.333) * ${nfs});
    --font-color: ${config['font-color']};
    --secondary-font-color: ${sfg};
    --background-color: ${config['background-color']};
    --modal-background-color: ${mbg};
    --shadow-background-color: ${sbg};
    --explorer-fx-nav-intensity: ${fxNavIntensity};    
    --radius: ${radius};
}
@media (orientation: landscape) {
    :root {
        --entries-per-row: ${config['view-size-x']};
        --entries-per-col: ${config['view-size-y']};
    }
}
@media (orientation: portrait) {
    :root {
        --entries-per-row: ${config['view-size-portrait-x']};
        --entries-per-col: ${config['view-size-portrait-y']};
    }
}
body {
    font-family: ${family};
}
`
        let ucase = config['uppercase-menu'] ? 'uppercase' : 'none'
        cssCode += `
*:not(input):not(textarea) {
    text-transform: ${ucase};
}
`
        css(cssCode, 'theme')
        const allowVerticalLayout = config['view-size-portrait-x'] == 1
        jQuery(document.body)[allowVerticalLayout ? 'addClass' : 'removeClass']('explorer-vertical')
        parent.animateBackground(config['animate-background'])
        parent.loaded()
        explorer.resize()
    }
}
themeRefresh()