var Pointer = (() => {
    var self = {};
    self.window = jQuery(window);
    self.body = jQuery('body');
    self.debug = false;
    self.navs = [];
    self.distanceAngleWeight = 5;
    self.selected = (wrap, hasData) => {
        var j, data, element = document.activeElement;
        if(element){
            j = jQuery(element);
            data = j.data('entry-data');
        }
        if(!data){
            j = jQuery('.focused');
            if(element.length){
                data = j.data('entry-data');            
            }
            element = j.get(0)
        }
        if(hasData && !data){
            return false;
        }
        return wrap ? j : element;
    }
    self.focus = (a, noscroll) => {
        if(!a || !a.length){
            a = Menu.getEntries(false, true).eq(Menu.path ? 1: 0)
        }
        if(a && a.length){
            if(self.debug){
                console.log('FOCUSENTRY', a.length, a.html(), noscroll, traceback())
            }
            if(!noscroll){
                if(self.body.hasClass('submenu')){
                    var l = Menu.getEntries(false, true).last();
                    //console.log('FOCUSENTRY', l.length, !l.is(':in-viewport'));
                    if(l.length && !l.is(':in-viewport')){
                        l.focus()
                    }
                } else {
                    let aq = a.filter('.entry').eq(0);
                    if(aq.length){
                        self.lastSelected = aq;
                    } else if(self.body.hasClass('submenu')) {
                        aq = Menu.getEntries(false, true)
                    } else {
                        aq = self.lastSelected;
                    }
                    //console.log('FOCUSENTRY', aq);
                    if(aq && aq.length){
                        aq = aq.eq(0);
                        let y = aq.offset();
                        if(y){
                            y = y.top + Menu.scrollContainer().scrollTop(), ah = aq.height();
                            //console.log('FOCUSENTRY', aq.html(), ah, y);
                            Menu.scrollContainer().scrollTop(y - ((Menu.scrollContainer().height() - ah) / 2));
                        }
                    }
                }
            }   
            jQuery('.focused').removeClass('focused');
            var f = a.addClass('focused').get(0);
            a.triggerHandler('focus');
            if(document.activeElement){
                // dirty hack to force input to lose focus
                if(document.activeElement.tagName.toLowerCase() == 'input'){
                    var t = document.activeElement;
                    t.style.visibility = 'hidden';
                    f.focus({preventScroll: true});
                    t.style.visibility = 'visible';
                }
            }
            f.focus({preventScroll: true});
            //console.warn('FOCUS', f, a)
        }
    }    
    self.navigables = (wrap, sel, cond) => {
        if(typeof(wrap) === 'string'){
            return self.navs.push({level: wrap, selector: sel, condition: cond}) // sel can be a selector string, set of elements or function returning elements
        }
        var navigables = []
        self.navs.forEach((nav) => {
            if(typeof(nav.condition) != 'function' || nav.condition()){
                var sel = nav.selector;
                if(typeof(sel)=='function'){
                    sel = sel()
                }
                if(nav.exclusive){
                    navigables = []
                }
                if(typeof(sel)=='string'){
                    self.body.find(sel).each((i, element) => {
                        navigables.push(element)
                    })
                } else {
                    jQuery(sel).each((i, element) => {
                        navigables.push(element)
                    })
                }
            }
        })
        return navigables
    }    
    self.distance = (c, e, m) => {
        var r = Math.hypot(e.x - c.x, e.y - c.y);
        if(m){
            r += r * (self.distanceAngleWeight * m)
        }
        return r;
    }
    self.ndiff = (a, b) => {
        return (a > b) ? a - b : b - a;
    }
    self.angle = (c, e) => {
        var dy = e.y - c.y;
        var dx = e.x - c.x;
        var theta = Math.atan2(dy, dx); // range (-PI, PI]
        theta *= 180 / Math.PI; // rads to degs, range (-180, 180]
        theta += 90;
        if(theta < 0){
            theta = 360 + theta;
        }
        return theta;
    }
    self.inAngle = (angle, start, end) => {
        if(end > start){
            return angle >= start && angle <= end;
        } else {
            return angle < end || angle > start; 
        }
    }
    self.coords = (element) => {
        if(element && typeof(element.getBoundingClientRect) == 'function'){
            var c = element.getBoundingClientRect();
            return {
                x: c.x + (c.width / 2), 
                y: c.y + (c.height / 2)
            }
        }
    }
    self.ecoords = (element) => {
        if(element && typeof(element.getBoundingClientRect) == 'function'){
            var c = element.getBoundingClientRect();
            /*
            return [
                {x: c.x, y: c.y}, // top left
                {x: c.x + c.width, y: c.y}, // top right
                {x: c.x, y: c.y + c.height}, // bottom left
                {x: c.x + c.width, y: c.y + c.height} // bottom right
            ]
            */
            return [
                {x: c.x, y: c.y}, // left
                {x: c.x + (c.width / 2), y: c.y}, // center
                {x: c.x + c.width, y: c.y} // right
            ]
        }
    }
    self.arrow = (direction) => {
        var angleStart = 0, angleEnd = 0, distTolerance = 50;
        switch(direction){
                case 'up':
                    angleStart = 270, angleEnd = 90;
                    break;
                case 'right':
                    angleStart = 0, angleEnd = 180;
                    break;
                case 'down':
                    angleStart = 90, angleEnd = 270;
                    break;
                case 'left':
                    angleStart = 180, angleEnd = 360;
                    break;
        }
        var closer, closerDist, e = self.selected(), navigables = self.navigables(), exy = self.coords(e);
        if(exy){
            navigables.forEach((n) => {
                if(n != e){
                    var nxy = self.coords(n);
                    if(nxy){
                        angle = self.angle(exy, nxy);
                        if(self.inAngle(angle, angleStart, angleEnd)){
                            var df, dist;
                            if(angleEnd > angleStart){
                                df = angleEnd - ((angleEnd - angleStart) / 2)
                            } else {
                                df = angleEnd - (((angleEnd + 360) - angleStart) / 2)
                                if(df < 0){
                                    df = 360 - df;
                                }
                            }
                            df = self.ndiff(df, angle);
                            dist = self.distance(exy, nxy, df);
                            if(self.debug){
                                console.warn('POINTER', dist, df, e, n, exy, nxy, angle, direction, angleStart, angleEnd)
                            }
                            if(!closer || dist < closerDist){
                                closer = n;
                                closerDist = dist;
                            }
                        }
                    }
                }
            })
        } else { // if none selected, pick anyone (first in navigables for now)
            closer = navigables[0];
            closerDist = 99999;
        }
        if(closer){
            if(self.debug){
                console.warn('POINTER', closer, closerDist)
            }
            self.focus(jQuery(closer))
        }
    }
    self.setup = () => {

    }
    return self;
})()