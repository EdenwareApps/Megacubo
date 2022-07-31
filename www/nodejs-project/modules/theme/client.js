if(typeof(themeRefresh) == 'undefined'){
    function themeRefresh(){
        const systemFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif'
        let family = config['font-family'], nfs = 0.0275 + (config['font-size'] * 0.0015)
        if(!family){
            family = systemFont
        } else if(family.indexOf(systemFont) == -1) {
            family += ','+ systemFont
        }
        let mbg = hexToRGBA(config['background-color'], config['background-color-transparency'] / 100)
        let sfg = hexToRGBA(config['font-color'], 0.75)
        let fxNavIntensityStep = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--explorer-fx-nav-intensity-step').trim())
        let fxNavIntensity = config['fx-nav-intensity'] * fxNavIntensityStep
        let fxNavDuration
        if(!config['fx-nav-intensity']){
            fxNavDuration = 0
        } else {
            let min = 0.175, max = 1
            fxNavDuration = min + (config['fx-nav-intensity'] * ((max - min) / 10))
        }
        let radius = top.cordova ? '1vmax' : '9px'
        let cssCode = `
:root {
    --explorer-fx-nav-duration: ${fxNavDuration}s;
    --explorer-entry-name-font-size: calc(((100vmin + 100vmax) * 0.333) * ${nfs});
    --font-color: ${config['font-color']};
    --secondary-font-color: ${sfg};
    --background-color: ${config['background-color']};
    --modal-background-color: ${mbg};
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
        --entries-per-row: ${config['view-size-y']};
        --entries-per-col: ${config['view-size-x']};
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
        parent.animateBackground(config['animate-background'])
        parent.loaded()
        explorer.resize()
    }
}
themeRefresh()