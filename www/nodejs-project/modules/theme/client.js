if(typeof(themeRefresh) == 'undefined'){
    function themeRefresh(){
        let family = config['font-family'], nfs = 0.02 + (config['font-size'] * 0.0025), mbg = hexToRGBA(config['background-color'], config['background-color-transparency'] / 100), sfg = hexToRGBA(config['font-color'], 0.75)
        let cssCode = `
:root {
    --explorer-entry-name-font-size: calc(((100vmin + 100vmax) * 0.333) * ${nfs});
    --font-color: ${config['font-color']};
    --secondary-font-color: ${sfg};
    --background-color: ${config['background-color']};
    --modal-background-color: ${mbg};
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
    }
}
themeRefresh()