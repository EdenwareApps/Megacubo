import { main } from '../bridge/renderer'

const colorChannelMixer = (colorChannelA, colorChannelB, amountToMix) => {
    var channelA = colorChannelA*amountToMix
    var channelB = colorChannelB*(1-amountToMix)
    return parseInt(channelA+channelB)
}
const colorMixer = (rgbA, rgbB, amountToMix) => {
    var r = colorChannelMixer(rgbA[0], rgbB[0], amountToMix)
    var g = colorChannelMixer(rgbA[1], rgbB[1], amountToMix)
    var b = colorChannelMixer(rgbA[2], rgbB[2], amountToMix)
    return "rgb("+ [r, g, b].join(", ") +")"
}
const isValidHex = (hex) => {
    return /^#([A-Fa-f0-9]{3,4}){1,2}$/.test(hex)
}    
const getChunksFromString = (st, chunkSize) => {
    return st.match(new RegExp(`.{${chunkSize}}`, "g"))
}    
const convertHexUnitTo256 = (hexStr) => {
    return parseInt(hexStr.repeat(2 / hexStr.length), 16)
}    
const getAlphafloat = (a, alpha) => {
    if (typeof a !== "undefined") {return a / 256}
    if (typeof alpha !== "undefined"){
        if (1 < alpha && alpha <= 100) { return alpha / 100}
        if (0 <= alpha && alpha <= 1) { return alpha }
    }
    return 1
}    
const hexToRGBA = (hex, alpha) => {
    if (!isValidHex(hex)) {
        throw new Error('Invalid HEX '+ hex)
    }
    const chunkSize = Math.floor((hex.length - 1) / 3)
    const hexArr = getChunksFromString(hex.slice(1), chunkSize)
    const [r, g, b, a] = hexArr.map(convertHexUnitTo256)
    return 'rgba('+ [r, g, b, getAlphafloat(a, alpha)].join(', ') +')'
}
const hexToRgb = ohex => {
    var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i, hex = ohex.replace(shorthandRegex, (m, r, g, b) => {
        return r + r + g + g + b + b
    })
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : ohex
}

class Theme {
    constructor(){
		this.curtains = Array.from(document.querySelectorAll('.curtain'))
        this.splashStartTime = (new Date()).getTime()
    }
    renderBackground(data) {
		console.warn('theming renderbackground', data)
        const bg = document.getElementById('background')
		if(data.video){
			bg.style.backgroundImage = 'none';		
			var v = bg.querySelector('video');
			if(!v || v.src != data.video){
				bg.innerHTML = '&nbsp;';
				setTimeout(function () {
					bg.innerHTML = '<video crossorigin src="'+ data.video +'" onerror="setTimeout(() => {if(this.parentNode)this.load()}, 500)" loop muted autoplay style="background-color: black;object-fit: cover;" poster="./assets/images/blank.png"></video>';
				}, 1000);
			}
		} else {
			var m = 'url("' + data.image +'")';
			if(bg.style.backgroundImage != m){
				bg.style.backgroundImage = m;
			}
			bg.innerHTML = '';
		}
		this.setCurtainsTransition(false, false)
	}
    animateBackground(val) {
        console.warn('animateBackground', val)
        var c = document.body.className || ''
        if(val.indexOf('-desktop') != -1){
            if(window.capacitor){
                val = 'none';
            } else {
                val = val.replace('-desktop', '');
            }
        }
        if(val == this.currentAnimateBackground){ // avoid background reload
            return
        }
        this.currentAnimateBackground = val
        if(val == 'fast'){
            var n = 'animate-background-fast';
            if(c.indexOf(n) == -1) {
                document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '') + ' ' + n;
            }
        } else if(val == 'slow') {
            var n = 'animate-background-slow';
            if(c.indexOf(n) == -1) {
                document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '') + ' ' + n;
            }
        } else {
            var n = 'animate-background';
            if(c.indexOf(n) != -1) {
                document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '');
            }
        }
    }
    update(image, video, color, fontColor, animate) {
        console.warn('theming', image, video, color, fontColor, animate);
        let data = localStorage.getItem('background-data')
        const bg = document.getElementById('background')
        const splash = document.getElementById('splash')
        if(!bg) return
        var defaultData = {
            image: screen.width > 1920 ? './assets/images/background-3840x2160.jpg' : './assets/images/background-1920x1080.jpg', 
            video: '', 
            color: '#15002C', 
            fontColor: '#FFFFFF', 
            animate: 'none'
        };
        if(data){
            data = JSON.parse(data);
            Object.keys(defaultData).forEach(function (k){
                if(typeof(data[k]) == 'undefined'){
                    data[k] = defaultData[k];
                }
            });
        } else {
            data = defaultData; // defaults
            try {
                localStorage.setItem('background-data', JSON.stringify(data));
            } catch(e) {
                console.error(e);
                data.video = '';
                data.image = '';
                localStorage.setItem('background-data', JSON.stringify(data));
                data.image = image;
                data.video = video;
            }
        }
        if(typeof(image) == 'string' || typeof(video) == 'string'){ // from node
            var changed;
            if(image != data.image){
                data.image = image || defaultData.image;
                changed = true;
            }
            if(video != data.video){
                data.video = video || defaultData.video;
                changed = true;
            }
            if(fontColor != data.fontColor){
                data.fontColor = fontColor;
                changed = true;
            }
            if(color != data.color){
                data.color = color;	
                changed = true;
            }
            if(animate != data.animate){
                data.animate = animate || 'none';
                changed = true;
            }
            if(changed){
                try {
                    localStorage.setItem('background-data', JSON.stringify(data));
                } catch(e) {
                    console.error(e);
                    data.image = '';
                    data.video = '';
                    localStorage.setItem('background-data', JSON.stringify(data));
                    data.image = image;
                    data.video = video;
                }
            }					
        }
        if(!data.image && !data.video){
            data.image = defaultData.image;
        }
        if(data.video){
            data.image = ''
        } else {
            data.video = defaultData.video;
        }
        console.warn('theming pre renderbackground', data)
        if(this.themeBackgroundReady === true){
            this.renderBackground(data)
        } else {
            if(typeof(this.themeBackgroundReady) == 'undefined'){
                this.themeBackgroundReady = (data => {
                    this.themeBackgroundReady = true
                    this.renderBackground(data)
                }).apply(this, [data])
            }
        }
        if(splash){
            splash.style.backgroundColor = data.color;
            splash.style.color = data.fontColor;
        }
        console.log('DATA', data)
        const systemFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif'
        let family = main.config['font-family'], nfs = 0.0275 + (main.config['font-size'] * 0.0015)
        if(!family){
            family = systemFont
        } else if(family.indexOf(systemFont) == -1) {
            family += ','+ systemFont
        }
        const sbg = colorMixer(Object.values(hexToRgb(main.config['background-color'])), [0, 0, 0], 0.5)
        const mbg = hexToRGBA(main.config['background-color'], main.config['background-color-transparency'] / 100)
        const obg = hexToRGBA(main.config['background-color'], 0.75)
        const sfg = hexToRGBA(main.config['font-color'], 0.6)
        const fxNavIntensityStep = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--menu-fx-nav-intensity-step').trim())
        const fxNavIntensity = main.config['fx-nav-intensity'] * fxNavIntensityStep
        let fxNavDuration
        if(!main.config['fx-nav-intensity']){
            fxNavDuration = 0
        } else {
            let min = 0.175, max = 1
            fxNavDuration = min + (main.config['fx-nav-intensity'] * ((max - min) / 10))
        }
        const radius = window.capacitor ? '1vmax' : '9px'
        const ucase = main.config['uppercase-menu'] ? 'uppercase' : 'none'
        let setAlpha = (c, a) => {
            return c.replace('rgb(','rgba(').replace(')', ', '+ a +')')
        }
        let baseColor = [70,70,70], baseFactor = 0.9
        let a = setAlpha(hexToRgb(colorMixer(Object.values(hexToRgb(main.config['background-color'])), baseColor, baseFactor)), 0.5)
        let b = setAlpha(hexToRgb(colorMixer(Object.values(hexToRgb(main.config['background-color'])), baseColor, baseFactor)), 0.65)
        let c = setAlpha(hexToRgb(colorMixer(Object.values(hexToRgb(main.config['background-color'])), baseColor, baseFactor)), 0.7)
        let d = setAlpha(hexToRgb(colorMixer(Object.values(hexToRgb(main.config['background-color'])), baseColor, baseFactor)), 1)

        baseColor = [255, 255, 255]
        let e = hexToRgb(colorMixer(Object.values(hexToRgb(main.config['background-color'])), baseColor, 0.32))
        let f = hexToRgb(colorMixer(Object.values(hexToRgb(main.config['background-color'])), baseColor, 0.40))

        let l = main.config['view-size'].landscape.x > 1 ? 'column' : 'row'
        let p = main.config['view-size'].portrait.x > 1 ? 'column' : 'row'

        let cssCode = `
        :root {
            --menu-fx-nav-duration: ${fxNavDuration}s;
            --font-color: ${main.config['font-color']};
            --secondary-font-color: ${sfg};
            --background-color: ${main.config['background-color']};
            --modal-background-color: ${mbg};
            --osd-background-color: ${obg};
            --shadow-background-color: ${sbg};
            --menu-fx-nav-intensity: ${fxNavIntensity};    
            --radius: ${radius};
        }
        body.video {
            --shadow-background-color: rgba(0, 0, 0, 0.8);
            --osd-background-color: rgba(0, 0, 0, 0.75);
        }
        @media (orientation: landscape) {
            :root {
                --menu-entry-name-font-size: calc(((100vmin + 100vmax) * 0.333) * ${nfs});
                --entries-per-row: ${main.config['view-size'].landscape.x} !important;
                --entries-per-col: ${main.config['view-size'].landscape.y} !important;
            }
        }
        @media (orientation: portrait) {
            :root {
                --menu-entry-name-font-size: calc(((100vmin + 100vmax) * 0.333) * ${nfs * 1.1});
                --entries-per-row: ${main.config['view-size'].portrait.x} !important;
                --entries-per-col: ${main.config['view-size'].portrait.y} !important;
            }
        }
        body {
            font-family: ${family};
        }
        body:not(.portrait) #menu content wrap {
            grid-template-columns: repeat(${main.config['view-size'].landscape.x}, 1fr);
            grid-template-rows: repeat(${main.config['view-size'].landscape.y}, 1fr);
        }
        body.portrait #menu content wrap {
            grid-template-columns: repeat(${main.config['view-size'].portrait.x}, 1fr);
            grid-template-rows: repeat(${main.config['view-size'].portrait.y}, 1fr);
        }
        *:not(input):not(textarea) {
            text-transform: ${ucase};
        }
        #menu a span.entry-wrapper {
            background: linear-gradient(to top, ${a} 0%, ${b} 75%, ${c} 100%) !important;
            border: 1px solid ${b} !important;
        }
        #menu content a.selected span.entry-wrapper {
            background: linear-gradient(to top, ${b} 0%, ${c} 75%, ${d} 100%) !important;
            border: 1px solid ${d} !important;
        }
        .modal-wrap > div {
            background: linear-gradient(to bottom, ${e} 0%, ${f} 100%) !important;
        }
        body.portrait .entry-2x {
            grid-${p}-start: span 2 !important;
        }
        body:not(.portrait) .entry-2x {
            grid-${l}-start: span 2 !important;
        }
        `
        main.css(cssCode, 'theme')
        this.animateBackground(data.video ? 'none' : data.animate)
        main.menu.resize(true) // force layout update
    }
    hideSplashScreen() {
        localStorage.setItem('splash-time-hint', String((new Date()).getTime() - this.splashStartTime))
        if (typeof(this.themeBackgroundReady) == 'function') {
            this.themeBackgroundReady()
        }
        const bg = document.getElementById('background')
        bg.style.visibility = 'visible'
        const splash = document.getElementById('splash')
        if (splash) {
            var s = document.querySelector('#main').style
            s.display = 'none'
            s.visibility = 'visible'
            s.display = 'block'
            document.body.style.backgroundImage = 'none'
            document.getElementById('background').style.visibility = 'visible'
        }
        setTimeout(() => splash.parentNode.removeChild(splash), 200)
        main.idle.reset()
    }
    closeCurtains(alpha, hideAfter, cb){
        if(!main.config || !main.config['fx-nav-intensity']) return
        this.curtainsOpening = false
        this.curtainsHideTimer && clearTimeout(this.curtainsHideTimer)
        this.setCurtainsTransition(false, true)
        this.setCurtainsState(true, alpha)
        this.curtainsHideTimer = setTimeout(() => {
            if(this.curtainsOpening) return
            this.setCurtainsTransition(true)
            this.curtainsHideTimer = setTimeout(() => {
                if(this.curtainsOpening) return
                this.curtainsHideTimer && clearTimeout(this.curtainsHideTimer)
                this.setCurtainsState(false)
                this.curtainsHideTimer = setTimeout(() => {
                    if(this.curtainsOpening) return
                    if(hideAfter){
                        this.curtainsHideTimer = setTimeout(() => {
                            this.setCurtainsTransition(false, false)
                            this.setCurtainsState(true, alpha)
                        }, 200)
                    }
                    cb && cb()
                }, 200)
            }, 25)
        }, 25)
    }
    openCurtains(alpha, hideAfter, cb) {
        if(!main.config || !main.config['fx-nav-intensity']) return
        this.curtainsHideTimer && clearTimeout(this.curtainsHideTimer)
        this.curtainsOpening = true
        this.setCurtainsTransition(false, true)
        this.setCurtainsState(false, alpha)
        this.curtainsHideTimer = setTimeout(() => {
            if(!this.curtainsOpening) return
            this.setCurtainsTransition(true)
            this.curtainsHideTimer = setTimeout(() => {
                if(!this.curtainsOpening) return
                this.curtainsHideTimer && clearTimeout(this.curtainsHideTimer)
                this.setCurtainsState(true)
                this.curtainsHideTimer = setTimeout(() => {
                    if(!this.curtainsOpening) return
                    if(hideAfter){
                        this.setCurtainsTransition(false, false)
                        this.setCurtainsState(true, alpha)
                    }
                    cb && cb()
                }, 200)
            }, 25)
        }, 25)
    }
    setCurtainsTransition(enable, show) {
        const atts = {}
        atts.transition = enable ? 'left 0.15s ease-in 0s, right 0.15s ease-in 0s, opacity 0.15s ease-in 0s' : 'none 0s ease 0s'
        if(typeof(show) == 'boolean') {
            atts.display = show ? 'block' : 'none'
        }
        this.curtains.forEach(e => {
            e.style.transition = atts.transition
            if(atts.display) e.style.display = atts.display
        })
    }
    setCurtainsState(opened, alpha) {
        if(opened) {
            document.documentElement.classList.add('curtains-opened')
            document.documentElement.classList.remove('curtains-closed')
        } else {
            document.documentElement.classList.add('curtains-closed')
            document.documentElement.classList.remove('curtains-opened')
        }
        if(typeof(alpha) == 'boolean') {
            document.documentElement.classList[alpha ? 'add': 'remove']('curtains-alpha')
        }
    }
}

const theme = new Theme()
main.theme = theme
main.waitRenderer(() => {
    theme.update()
    theme.hideSplashScreen()
    main.on('config', () => theme.update())
})

main.on('theme-update', (image, video, color, fontColor, animate) => {
    try {
        theme.update(image, video, color, fontColor, animate)
    } catch(e) {console.error(e)}
})
main.on('player-show', () => {
    theme.animateBackground('none')
    theme.closeCurtains(false, true)
})
main.on('player-hide', () => {
    theme.openCurtains(false, true, () => {
        theme.animateBackground(main.config['animate-background'])
    })
})
main.idle.energySaver.on('start', () => {
    theme.animateBackground('none')
    theme.closeCurtains(true, false)
})
main.idle.energySaver.on('end', () => {
    theme.openCurtains(true, true, () => {
        theme.animateBackground(main.config['animate-background'])
    })
})
main.on('exit-ui', () => {
    theme.closeCurtains(false, false)
	theme.closeCurtains = () => {} // prevent duped effect
})
