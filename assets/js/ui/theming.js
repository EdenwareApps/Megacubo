

    function loadTheming(opts, _cb){
        var srcFile = 'assets/css/theme.src.css';
        fs.readFile(srcFile, (err, content) => {
            console.log('loadTheming');
            if(!err){
                let scrl, bgcolor = Theme.get('background-color'), bg = jQuery('#background-overlay');
                content += "\r\n" + Theme.get('inline-css');
                content = parseTheming(content, opts);
                if(typeof(Menu) != 'undefined'){
                    scrl = Menu.saveScroll(true)
                }
                stylizer(content, 'theming', window);
                redrawBackgroundImage();
                redrawLogoImage();
                if(getColorLightLevel(bgcolor) > 50){
                    document.documentElement.className += ' ui-light';                    
                } else {
                    document.documentElement.className = document.documentElement.className.replaceAll('ui-light', '');
                }
                if(Theme.get("menu-opacity") < 99){
                    bg.removeClass('fit-player').addClass('fit-screen').find('.background-logo-container').addClass('fit-player');
                    document.documentElement.className += ' ui-transparent-menu';                    
                } else {
                    bg.removeClass('fit-screen').addClass('fit-player').find('.background-logo-container').removeClass('fit-player');
                    document.documentElement.className = document.documentElement.className.replaceAll('ui-transparent-menu', '');
                }
                if(scrl){
                    console.warn("SCRL", scrl);
                    Menu.restoreScroll(scrl)
                }
                if(typeof(doAction) == 'function'){
                    try {
                        doAction('afterLoadTheming')
                    } catch(e) {
                        console.error(e)
                    }
                }
                if(typeof(_cb) == 'function'){
                    _cb()
                }
                if(typeof(updateMenuDimensions)=='function'){
                    updateMenuDimensions()
                }
            }
        });     
        if(Config.get('tooltips')){
            applyCSSTemplate('assets/css/balloon.src.css', window)
        } else {
            stylizer('', 'balloon', window)
        }  
        applyCSSTemplate('assets/css/player.src.css', getPlayerScope())
        applyCSSTemplate('assets/css/overlay.src.css', getFrame('overlay'))
    }

    function getPlayerScope(){      
        var scope = (typeof(Playback) != 'undefined' && Playback.active) ? Playback.active.getVideo() : false;
        if(scope) {
            scope = scope.ownerDocument.defaultView;
        } else {
            scope = document.querySelector('iframe#player');
            scope = scope ? scope.contentWindow : false;
        }
        return scope
    }

    function applyCSSTemplate(src, scope){
        fs.readFile(src, (err, content) => {
            if(err){
                throw err;
            }
            if(content){
                stylizer(parseTheming(content), basename(src).replace('.src.css', ''), scope)
                console.log('Applied CSS', src)
            }
        })
    }

    var isFirstBackgroundDraw = true;
    function redrawBackgroundImage(){
        var bg = document.querySelector('#background-overlay');
        if(bg) {
            var defaultBackground = 'assets/images/blank.png';
            var n, content = Theme.get('background-image'), rm = document.querySelector('img.background-image, video.background-image');
            switch(content.substr(5, 5)){
                case 'image':
                    n = '<img class="background-image fit-screen" src="' + content + '" />';
                    break;
                case 'video':
                    n = '<video class="background-image fit-screen" loop autoplay muted src="' + content + '" />';
                    break;
                default:
                    n = '<img class="background-image fit-screen" src="' + defaultBackground + '" style="background: ' + content+ '" />';
                    break;
            }
            if(n){
                if(rm){
                    rm.parentNode.removeChild(rm)
                }
                jQuery(n).insertBefore(bg)
            }
        }
    }

    var isFirstLogoDraw = true;
    function redrawLogoImage() {
        var bg = document.querySelector('#background-overlay');
        if(bg) {
            var defaultLogo = 'default_icon.png';
            var n, content = Theme.get('logo') || '', rm = bg.querySelector('.background-logo-container');
            switch(content.substr(5, 5)) {
                case 'image':
                    applyIcon(content);
                    n = '<div class="background-logo-container fit-player"><img class="background-logo" src="' + content + '" /></div>';
                    break;
                default:
                    applyIcon(defaultLogo);
                    n = '<div class="background-logo-container fit-player"><img class="background-logo" src="' + defaultLogo + '" /></div>';
                    break;
            }
            if(n) {
                if(rm) {
                    bg.removeChild(rm)
                }
                jQuery(n).appendTo(bg)
            }
        }
    }

    function parseTheming(content, opts){
        let bg = Theme.get('background-image') || 'linear-gradient(to top, #000004 0%, #01193c 75%)';
        if(['image', 'video'].indexOf(bg.substr(5, 5)) != -1){
            bg = 'url("'+bg+'")';
        }
        let maxPlayerStatusOpacity = 0.75, mt = Math.round(Theme.get('menu-opacity') * (255 / 100)), ht = Math.round(Theme.get('highlight-opacity') * (255 / 100)), data = {
            'background-image': bg,
            'background-animation': 'bga-' + Theme.get('tuning-background-animation'),
            'background-color-playing': Theme.get('background-color-playing'),
            'background-color-playing-enc': encodeURIComponent(Theme.get('background-color-playing')),
            'background-color': Theme.get('background-color'),
            'background-opacity': Theme.get('background-opacity') / 100,
            'font-color': Theme.get('font-color'),
            'font-size': Theme.get('font-size'),
            'font-family': Theme.get('font-family'),
            'font-weight': Theme.get('font-weight'),
            'highlight-opacity': Theme.get('highlight-opacity') / 100,
            'highlight-opacity-hex': componentToHex(ht),
            'icon-size': Theme.get('icon-size'),
            'icon-rounding': Theme.get('icon-rounding') + '%',
            'logo-opacity': Theme.get('logo-opacity') / 100,
            'menu-entry-vertical-padding': Theme.get('menu-entry-vertical-padding') || 12,
            'menu-inset-shadow-start': Theme.get('menu-inset-shadow') + '%',
            'menu-inset-shadow-end': (100 - Theme.get('menu-inset-shadow')) + '%',
            'menu-margin': Theme.get('menu-margin') / 100,
            'menu-opacity-hex': componentToHex(mt),
            'menu-text-case': Theme.get('menu-uppercase') ? 'uppercase' : 'none',
            'menu-width': (Theme.get('menu-width') || 34) + '%', // percent of window width
            'player-status-transparency-hex': mt > (255 * maxPlayerStatusOpacity) ? componentToHex(Math.round(255 * maxPlayerStatusOpacity)) : componentToHex(mt),
            'theme': Theme.get('name')
        };
        if(data.fontsize > 2){
            data.fontsize = 1;
        }
        if(typeof(opts) == 'object' && opts){
            data = Object.assign(data, opts);
        } 
        content = String(content);
        Object.keys(data).forEach((key) => {
            if(content.indexOf('('+key) != -1){
                content = content.replace(new RegExp('\\('+key.replaceAll('-', '.{0,2}')+'\\)', 'g'), data[key]);
            }
        });
        return content;
    }
    