
var AutoScaler = (() => {
    var self = {};
    self.lightLevelLimit = 20;
    self.detectBlackBorders = (cb) => {
        var v = Playback.active ? Playback.active.getVideo() : false;        
        if(v){
            if(!self.canvas){
                self.canvas = document.createElement('canvas')
                self.context = self.canvas.getContext('2d') 
                jQuery(self.canvas).addClass('hide').appendTo('body')
            }      
            var x = 0, y = -1, cw = v.clientWidth, ch = v.clientHeight, dys = 0, dye = ch;        
            self.canvas.width = cw;
            self.canvas.height = ch;
            self.context.drawImage(v, 0, 0, cw, ch)
            // Grab the pixel data from the backing canvas
            var idata = self.context.getImageData(0, 0, cw, ch)
            var data = idata.data;
            //console.warn('IDATA', cw, ch)
            for(var i = 0; i < data.length; i += 4) {
                var rgb = {r: data[i], g: data[i+1], b: data[i+2]}, l = getColorLightLevelFromRGB(rgb)
                if((i / 4) == (y * cw)){
                    y++;
                    x = 0;
                } else {
                    x++;
                }
                if(l > self.lightLevelLimit){
                    console.warn('LIMIT', x, y, l, rgb)
                    dys = y + 1;
                    break;
                }
            }
            y = ch, x = cw;
            for(var i = data.length; i > 0; i -= 4) {
                var rgb = {r: data[i], g: data[i+1], b: data[i+2]}, l = getColorLightLevelFromRGB(rgb)
                if((i / 4) == (y * cw)){
                    y--;
                    x = cw - 1;
                } else {
                    x--;
                }
                if(l > self.lightLevelLimit){
                    // console.warn('LIMIT', x, y, l, rgb)
                    dye = y + 1;
                    break;
                }
            }
            // console.warn('IDATA', x, y, dys, dye)
            return cb(null, cw, ch, dys, dye)
        } else {
            return cb(true, 0, 0, 0, 0)
        }
    }
    self.update = () => {
        var v = Playback.active ? Playback.active.getVideo() : false; 
        if(v) {
            if(Config.get('autofit')){
                var p = jQuery('#player'), pw = p.width(), ph = p.height()
                var vw = v.clientWidth, vh = v.clientHeight;
                if(((vw / vh) > (pw / ph))){
                    v.style.transform = 'scale(' + (ph / vh) + ')';
                    return;
                }
            } 
            v.style.transform = 'none';
            v.style.removeProperty('min-width') // was breaking centralize on youtube.com
            v.style.removeProperty('min-height')
        }
    }
    return self;
})()

var delayedAutoScalerUpdate = () => {
    setTimeout(AutoScaler.update, 400)
}

$win.on('resize', AutoScaler.update)

Playback.on('getVideo', (v) => {
    var j = jQuery(v)
    j.one('playing', AutoScaler.update)
})

Playback.on('setRatio', delayedAutoScalerUpdate)

addAction('menuShow', delayedAutoScalerUpdate)
addAction('menuHide', delayedAutoScalerUpdate)

