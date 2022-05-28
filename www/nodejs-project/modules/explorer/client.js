/**
*
*  Base64 encode / decode
*  http://www.webtoolkit.info
*
**/
var Base64 = {
    _keyStr: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=", 
	encode: function (input)
    {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        input = Base64._utf8_encode(input);

        while (i < input.length)
        {
            chr1 = input.charCodeAt(i++);
            chr2 = input.charCodeAt(i++);
            chr3 = input.charCodeAt(i++);

            enc1 = chr1 >> 2;
            enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            enc4 = chr3 & 63;

            if (isNaN(chr2))
            {
                enc3 = enc4 = 64;
            }
            else if (isNaN(chr3))
            {
                enc4 = 64;
            }

            output = output +
                this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
                this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);
        } // Whend 

        return output;
    },
	decode: function (input)
    {
        var output = "";
        var chr1, chr2, chr3;
        var enc1, enc2, enc3, enc4;
        var i = 0;

        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
        while (i < input.length)
        {
            enc1 = this._keyStr.indexOf(input.charAt(i++));
            enc2 = this._keyStr.indexOf(input.charAt(i++));
            enc3 = this._keyStr.indexOf(input.charAt(i++));
            enc4 = this._keyStr.indexOf(input.charAt(i++));

            chr1 = (enc1 << 2) | (enc2 >> 4);
            chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            chr3 = ((enc3 & 3) << 6) | enc4;

            output = output + String.fromCharCode(chr1);

            if (enc3 != 64)
            {
                output = output + String.fromCharCode(chr2);
            }

            if (enc4 != 64)
            {
                output = output + String.fromCharCode(chr3);
            }

        } // Whend 

        output = Base64._utf8_decode(output);

        return output;
    },
	_utf8_encode: function (string)
    {
        var utftext = "";
        string = string.replace(/\r\n/g, "\n");

        for (var n = 0; n < string.length; n++)
        {
            var c = string.charCodeAt(n);

            if (c < 128)
            {
                utftext += String.fromCharCode(c);
            }
            else if ((c > 127) && (c < 2048))
            {
                utftext += String.fromCharCode((c >> 6) | 192);
                utftext += String.fromCharCode((c & 63) | 128);
            }
            else
            {
                utftext += String.fromCharCode((c >> 12) | 224);
                utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                utftext += String.fromCharCode((c & 63) | 128);
            }

        } // Next n 

        return utftext;
    },
	_utf8_decode: function (utftext)
    {
        var string = "";
        var i = 0;
        var c, c1, c2, c3;
        c = c1 = c2 = 0;

        while (i < utftext.length)
        {
            c = utftext.charCodeAt(i);

            if (c < 128)
            {
                string += String.fromCharCode(c);
                i++;
            }
            else if ((c > 191) && (c < 224))
            {
                c2 = utftext.charCodeAt(i + 1);
                string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                i += 2;
            }
            else
            {
                c2 = utftext.charCodeAt(i + 1);
                c3 = utftext.charCodeAt(i + 2);
                string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                i += 3;
            }

        } // Whend 

        return string;
    }
}

class ExplorerURLInputHelper {
    constructor(){
        this.events = [
            ['.modal-wrap input', 'keyup', e => {
                if(e.keyCode == 13){
                    e.preventDefault()
                    let m = document.getElementById('modal-template-option-submit')
                    if(m){
                        m.click()
                    }
                }
            }],
            ['.modal-wrap input[placeholder^="http"]', 'keyup', e => {
				let v = e.target.value
                if(v.length == 6 && v.indexOf(':') == -1){
                    e.target.value = 'http://' + v
                }
            }]
        ]
        this.active = false
	}
	getInputElement(){
		return document.querySelector('.modal-wrap input, .modal-wrap textarea')
	}
    start(){
        if(!this.active){
			this.active = true
			this.apply('on')
			let e = this.getInputElement()
			if(e){
				e.select()
			}
        }
    }
    stop(){
        this.apply('off')
        this.active = false
    }
    apply(type){
		this.events.forEach((e, i) => {
			$(this.events[i][0])[type](this.events[i][1], this.events[i][2])
		})
    }
}

class ExplorerBase extends EventEmitter {
	constructor(jQuery, container, app){
		super()
		this.debug = false
		this.app = app
		this.j = jQuery
		this.body = this.j('body')
		this.container = this.j(container)
	}
    addClass(element, className){
        if(!this.hasClass(element, className)){
            element.className = (element.className || '') + ' ' + className
        }
    }
    removeClass(element, className){
        if(this.hasClass(element, className)){
            element.className = element.className.replace(className, '')
        }
    }
    hasClass(element, className){
        return element.className && element.className.indexOf(className) != -1
    }
}

class ExplorerSelectionMemory extends ExplorerBase {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.selectionMemory = {}
		this.on('open', () => {
			//if(type == 'group'){
				//console.log('selectionMemory open', this._wrapper.scrollTop, this.selectedIndex)
				this.selectionMemory[this.path] = {scroll: this._wrapper.scrollTop, index: this.selectedIndex}
			//}
		})
		this.on('arrow', () => {
			//if(type == 'group'){
				//console.log('selectionMemory arrow', this._wrapper.scrollTop, this.selectedIndex)
				this.selectionMemory[this.path] = {scroll: this._wrapper.scrollTop, index: this.selectedIndex}
			//}
		})
		this.on('pre-render', () => {
			//if(type == 'group'){
				//console.log('selectionMemory pre-render', this._wrapper.scrollTop, this.selectedIndex)
				this.selectionMemory[this.path] = {scroll: this._wrapper.scrollTop, index: this.selectedIndex}
			//}
		})
		this.on('pre-modal-start', () => {
			let e = this.selected()
			if(e && e.title){
				this.selectionMemory[this.path] = {scroll: this._wrapper.scrollTop, index: this.selectedIndex}
			}
		})
        this.on('pos-modal-end', this.updateSelection.bind(this))
		this.app.on('explorer-reset-selection', () => {
            this.selectionMemory = {}
        })
	}
	updateSelection(){
		return this.updateSelectionCB(this.path, '', true)
	}
	updateSelectionCB(path, icon){
		if(this.isExploring()){
            this.scrollDirection = ''
            this.scrollSnapping = true
			let target = 0, index = 1, isSearch = path.split('/').pop() == lang.SEARCH
			if(isSearch){
                this._scrollContainer.scrollTop = target
                this.focusIndex(index, false, true)
                this.scrollSnapping = false
				return true
            } else {
                this.scrolling = false
				return this.restoreSelection()
			}
		}
    }
    restoreSelection(){
        let data = {scroll: 0, index: this.path ? 1 : 0}
        if(typeof(this.selectionMemory[this.path]) != 'undefined' && this.path.indexOf(lang.SEARCH) == -1 && this.path.indexOf(lang.MORE_RESULTS) == -1){
            data = this.selectionMemory[this.path]
            if(data.index == 0 && this.path){
                data.index = 1
            }
        }
        //console.log('selectionMemory restore', data.scroll, data.index, this.path)
		// this._scrollContainer.scrollTop = data.scroll
        this._scrollContainer.scrollTo(0, data.scroll)
        if(this.activeView().level == 'default'){
			let range = this.viewportRange(data.scroll)
			if(data.index < range.start || data.index >= range.end){
				data.index = range.start
			}
			this.focus(this.currentElements[data.index], true)
            this.focusIndex(data.index, true, true) // true = force re-selecting the same entry on refresh
			return true
        }
    }
}

class ExplorerPointer extends ExplorerSelectionMemory {
    constructor(jQuery, container, app){ // window, document, jQuery, container
        super(jQuery, container, app)
        if(typeof(container) == 'string'){
            container = document.querySelector(container)
        }
		this._scrollContainer = container.querySelector('wrap')
		this.scrollContainer = this.j(this._scrollContainer)
		this.views = []
		this.defaultNavGroup = ''
        this.distanceAngleWeight = 0.005
        this.className = 'selected'
        this.parentClassName = 'selected-parent'
        this.selectedIndex = 0
        this.setViewSize(2, 7)
        window.addEventListener('resize', this.resize.bind(this))
        this.mouseWheelMovingTime = 0
        this.mouseWheelMovingInterval = 300
        this.scrolling = false
        this.scrollingTimer = 0
        this.scrollDirection = 'down'
        this.lastScrollTop = 0
        this.scrollContainer.on('mousedown', () => this.manuallyScrolling = true)
        this.scrollContainer.on('mouseup', () => this.manuallyScrolling = false);
        ['touchmove', 'scroll', 'mousewheel', 'DOMMouseScroll'].forEach(n => {
            this.scrollContainer.on(n, event => {
                if(this.debug){
                    console.log('pointer.scroll', this.rendering)
                }
                if(this.rendering){
                    return
                }
                let isTrusted
                if(n == 'scroll'){
                    isTrusted = false
                } else {
                    if(typeof(event.isTrusted) != 'undefined'){
                        isTrusted = event.isTrusted
                    } else if(event.originalEvent && typeof(event.originalEvent.isTrusted) != 'undefined'){
                        isTrusted = event.originalEvent.isTrusted
                    }
                }
                if(this.debug){
                    console.log('pointer.scroll', n, this.scrollSnapping, isTrusted, event)
                }
                if(this.scrollSnapping){
                    if(isTrusted){
                        this.scrollContainer.stop(true, false)
                        this.scrollSnapping = false
                    }
                }
                clearTimeout(this.scrollingTimer)
                let st = this._scrollContainer.scrollTop
                if(st > this.lastScrollTop){
                    this.scrollDirection = 'down'
                } else if(st < this.lastScrollTop) {
                    this.scrollDirection = 'up'
                }
                if(this.debug){
                    console.log('pointer.scroll', n, this.lastScrollTop, st)
                } 
                if(['mousewheel', 'DOMMouseScroll'].indexOf(n) != -1){
                    this.scrolling = false
                    let now = (new Date()).getTime()
                    if(now > (this.mouseWheelMovingTime + this.mouseWheelMovingInterval)){
                        this.mouseWheelMovingTime = now
                        let delta = (event.originalEvent.wheelDelta || -event.originalEvent.detail)
                        this.arrow((delta > 0) ? 'up' : 'down', true)
                        this.emit('scroll', this.lastScrollTop, this.scrollDirection)
                    }
                    event.preventDefault()
                } else { 
                    if(this.lastScrollTop != st){
                        this.lastScrollTop = st    
                        this.scrolling = true
                        this.scrollingTimer = setTimeout(() => {
                            if(this.debug){
                                console.log('pointer.scroll', this.rendering)
                            }
                            if(this.rendering){
                                return
                            }
                            if(this.scrolling){
                                this.scrolling = false
                            }
                            const done = () => {                                
                                if(this.debug){
                                    console.log('pointer.scroll', this.rendering)
                                }
                                if(this.rendering){
                                    return
                                }
                                this.emit('scroll', this.lastScrollTop, this.scrollDirection)
                            }
                            if(this.manuallyScrolling){
                                done()
                            } else {
                                this.scrollSnap(this.lastScrollTop, this.scrollDirection, done)
                            }
                        }, 250)
                    }
                }
            })
        }) 
    }
    scrollSnap(scrollTop, direction, cb){
        if(this.rendering){
            return
        }
        if(scrollTop == 0 && this._scrollContainer.scrollTop == 0){ 
            return cb()
        }
        let h = this.currentElements[0].offsetHeight, ih = parseInt(scrollTop / h)
        let start = ih * h, end = start + h, startDf = Math.abs(start - scrollTop), endDf = Math.abs(end - scrollTop)
        if(direction == 'down') {
            if((startDf + (h / 3)) > endDf){ // give down direction hint of 1/3
                ih++
            }
        } else { // up by default, if not defined
            if((startDf - (h / 3)) > endDf){ // give up direction hint of 1/3
                ih++
            }
        }
        this.scrollSnapping = true
        this.scrollContainer.animate({scrollTop: ih * h}, 150, () => {
            this.scrollSnapping = false
            this.lastScrollTop = this._scrollContainer.scrollTop
            cb()
        })
    }
    setViewSize(x, y){
        this._viewSizeX = x
        this._viewSizeY = y
        this.resize()
    }
    resize(){
        const portrait = (window.innerHeight > window.innerWidth)
        if (portrait) {
            this.viewSizeX = this._viewSizeY
            this.viewSizeY = this._viewSizeX
        } else {
            this.viewSizeX = this._viewSizeX
            this.viewSizeY = this._viewSizeY
        }
		let e = document.querySelector('.entry-icon-image')
		if(e){
			let metrics = e.getBoundingClientRect()
			if(metrics && metrics.width){
				let min = Math.min(metrics.width, metrics.height) * 0.9
				css(`

				#explorer content a .entry-icon-image i {
    				font-size: ${min}px;
				}

				`, 'entry-icon-i')
			}			
		} else {
			console.log('Delaying icon size calc')
			setTimeout(() => this.resize(), 1000)
		}
    }
    isVisible(e) {
        return e.offsetParent !== null
    }
    selector(s){
        return Array.from(this.body.get(0).querySelectorAll(s)).filter(this.isVisible)
    }
    start(){
        this.body.on('focus', this.selected.bind(this))
        this.selected()
    }
    updateElement(element){ // if view has changed, find the actual corresponding element
        if(!element.parentNode){
            let prop, val
            ['title', 'data-path', 'id'].some(p => {
                if(val = e.getAttribute(p) && val.indexOf('"') == -1){
                    prop = p
                    return true
                }
            })
            let sel = e.tagName + (prop ? '[' + prop + '="' + val + '"]' : ''), n = document.querySelector(sel)
            if(n){
                element = n
            }
        }
        return element
    }
    selectables(){
        let elements = [], view = this.activeView() // is any explicitly selected??
        if(view){
            if(typeof(view.resetSelector) == 'function'){
                elements = view.resetSelector()
            } else {
                elements = this.entries()
            }
        }
        return $(elements)
    }
    findSelected(){
        let elements, element = document.activeElement
        if(element && element != document.body && (!element.className || element.className.indexOf(this.className) == -1)){ // not explicitly selected
            let elements = this.selectables() // check if is any explicitly selected??
            let selected = elements.filter('.' + this.className)
            if(selected.length){
                element = selected.get(0) // yes, that's one explicitly selected
            } else {
                element = this.updateElement(element) // find this element in current view, if it's not
                if(!element.parentNode){ // not found, we'll reset so
                    element = false
                }
            }
        }
        if(!element || element == document || element == document.body){
            if(typeof(elements) == 'undefined'){
                elements = this.selectables()
            }
            let selected = elements.filter('.' + this.className)
            if(selected.length){
                element = selected.get(0) // yes, that's one explicitly selected
            } else {
                element = elements.get(0)
            }
        }        
        if(this.debug){
            console.log('findSelected', element, elements)
        }
        return element
    } 
	selected(wrap){
        let jj, element = this.findSelected()
        if(element){
            jj = this.j(element)
            if(!jj.hasClass(this.className)){
                jj.addClass(this.className).parent().addClass(this.parentClassName)
            }
            element.focus({preventScroll: true})
        }
        return wrap ? (jj || this.j(element)) : element
    }
    focusIndex(a, force, avoidScroll){
        if(force || a != this.selectedIndex){
            a = this.scrollContainer.find('a[tabindex="'+ (a ? a : '') +'"]').get(0)
            if(this.debug){
                console.log('FOCUSINDEX', a)
            }
            if(a){
                this.focus(a, avoidScroll)
            }
        }
    }
    focus(a, avoidScroll){
        let ret = null        
        if(this.debug){
            console.log('focus', a, avoidScroll, traceback())
        }
        if(!a) {
            a = this.entries().shift()
        } else if(a instanceof this.j) {
            if(this.debug){
                console.error('focus received jQuery element', a, avoidScroll, traceback())
            }
            a = a.get(0)
        }
        if(a && a != this.selected()){
            if(!a.parentNode) return // fix
            if(this.debug){
                console.log('FOCUSENTRY', a)
            }
            document.querySelectorAll('.' + this.className).forEach(e => {
                if(e != a){
                    this.removeClass(e, this.className)
                    this.removeClass(e.parentNode, this.parentClassName)
                }
            })
            this.addClass(a, this.className)
            this.addClass(a.parentNode, this.parentClassName)
            let index = a.tabIndex
            if(typeof(index) != 'number'){
                index = -1
            }
            if(document.activeElement && document.activeElement.tagName.toLowerCase() == 'input'){
                // dirty hack to force input to lose focus
                let t = document.activeElement
                t.style.visibility = 'hidden'
                a.focus({preventScroll: true})
                t.style.visibility = 'inherit'
            } else {
                a.focus({preventScroll: true})
            }
            let n = a.querySelector('input:not([type="range"]), textarea')
            if(n) {
                n.focus({preventScroll: true})
            }
            if(index != -1) { // is main menu entry
                let lastIndex = this.selectedIndex
                this.selectedIndex = index
                if(this.debug) {
                    console.log('pointer selectedIndex =', a.tabIndex, a)
                }
				//console.log('AVOID SCROLL', avoidScroll, a.offsetTop, this._scrollContainer.scrollTop, this._scrollContainer.offsetHeight, traceback())
				if(avoidScroll && (a.offsetTop < this._scrollContainer.scrollTop || a.offsetTop >= (this._scrollContainer.scrollTop + this._scrollContainer.offsetHeight - 4))){
					avoidScroll = false
				}
                if(!avoidScroll) {
                    if(lastIndex != this.selectedIndex) {
                        let s = a.offsetTop
                        if(s < 0) {
                            s = 0
                        }
                        if(s != a.parentNode.scrollTop) {
                            a.parentNode.scrollTop = ret = s
                        }
                    }
                }
            }
            this.emit('focus', a, index)
        }
        return ret
    }  
    activeView(){     
        let ret = false 
        this.views.some(view => {
            if(!ret){
                ret = view
            }
            if(view.condition()){
                ret = view
                return true
            }
        })
        return ret
    }
    reset(){        
        if(this.debug){
            console.log('reset', traceback())
        }
        let elements, view = this.activeView()
        if(typeof(view.resetSelector) == 'function'){
            elements = view.resetSelector()
        } else {
            elements = this.entries()
        }
        if(elements.length && elements.indexOf(this.selected()) == -1){
            elements = elements.filter(e => e.getAttribute('data-type') != 'back').slice(0)
            if(elements.length){
                let _sound = sound
                this.focus(elements[0], true)
                sound = _sound
            }
        }
    }
    entries(){
		let e = [], view = this.activeView(), sel = view.selector
        if(typeof(sel)=='function'){
            sel = sel()
        }
        if(typeof(sel)=='string'){
            e = e.concat(this.selector(sel))
        } else {
            e = e.concat(sel)
        }
		return e.filter(n => {
            return !n.className || n.className.indexOf('explorer-not-navigable') == -1
        })
    }
    addView(view){
        if(view.default === true || !this.defaultNavGroup){
            this.defaultNavGroup = view.level
        }
        return this.views.push(view) // add.selector can be a selector string, set of elements or function returning elements
    }
    distance(c, e, m){
        let r = Math.hypot(e.left - c.left, e.top - c.top);
        if(m){
            r += r * (this.distanceAngleWeight * m)
        }
        return r;
    }
    ndiff(a, b){
        return (a > b) ? a - b : b - a;
    }
    angle(c, e){
        let dy = e.top - c.top
        let dx = e.left - c.left
        let theta = Math.atan2(dy, dx) // range (-PI, PI]
        theta *= 180 / Math.PI // rads to degs, range (-180, 180]
        theta += 90
        if(theta < 0){
            theta = 360 + theta
        }
        return theta
    }
    inAngle(angle, start, end){
        if(end > start){
            return angle >= start && angle <= end
        } else {
            return angle < end || angle > start
        }
    }
    coords(element){
        if(element && typeof(element.getBoundingClientRect) == 'function'){
            let c = element.getBoundingClientRect()
            return {
                left: c.left + (c.width / 2), 
                top: c.top + (c.height / 2)
            }
        }
    }
    ecoords(element){
        if(element && typeof(element.getBoundingClientRect) == 'function'){
            let c = element.getBoundingClientRect()
            return [
                {left: c.left, top: c.top}, // left
                {left: c.left + (c.width / 2), top: c.top}, // center
                {left: c.left + c.width, top: c.top} // right
            ]
        }
    }
    opposite(selected, items, direction){
        let i, n = items.indexOf(selected), x = this.viewSizeX, y = this.viewSizeY
        switch(direction){
            case 'down':
                i = n % x
                break
            case 'up':
                i = (Math.floor(items.length / x) * x) + (n % x)
                if(i >= items.length){
                    i = ((Math.floor(items.length / x) - 1) * x) + (n % x)
                }
                break
            case 'left':
                i = n
                i += (x - 1)
                if(i >= items.length){
                    i = items.length - 1
                }
                break
            case 'right':
                i = n
                i -= (x - 1)
                if(i < 0){
                    i = 0
                }
                break
        }        
        if(this.debug){
            console.log(i, items.length)
        }
        return items[i]
    }
    arrow(direction, noCycle){
        let closer, closerDist, items = this.entries(), view = this.activeView(), e = this.selected()
        if(view.default === true){ // on default view, calc it based on view size
            let i = items.indexOf(e)
            switch(direction){
                case 'up':
                    i -= this.viewSizeX
                    if(i < 0){
                        i = -1
                    }
                    break
                case 'down':
                    i += this.viewSizeX
                    if(i >= items.length){
                        i = -1
                    }
                    break
                case 'right':
                    i++
                    if(!(i % this.viewSizeX) || i >= items.length){
                        i = -1
                    }
                    break
                case 'left':
                    if(!(i % this.viewSizeX)){
                        i = -1
                    } else {
                        i--
                        if(i < 0){
                            i = -1
                        }
                    }
                    break
            }            
            if(this.debug){
                console.log('default calc', i)
            }
            if(i >= 0){
                closer = items[i]
            }
        } else { // on other views, check spatially where to go
            let angleStart = 0, angleEnd = 0, distTolerance = 50
            switch(direction){
                case 'up':
                    angleStart = 270, angleEnd = 90
                    break
                case 'right':
                    angleStart = 0, angleEnd = 180
                    break
                case 'down':
                    angleStart = 90, angleEnd = 270
                    break
                case 'left':
                    angleStart = 180, angleEnd = 360
                    break
            }
            let closerDist, exy = this.coords(e)
            if(exy){
                items.forEach(n => {
                    if(n != e){
                        let nxy = this.coords(n)
                        if(nxy){
                            if(['up', 'down'].indexOf(direction) != -1){ // avoid bad horizontal moving
                                if(nxy.top == exy.top && n.offsetHeight == e.offsetHeight){
                                    return
                                }
                            }
                            if(['left', 'right'].indexOf(direction) != -1){ // avoid bad vertical moving
                                if(nxy.left == exy.left && n.offsetWidth == e.offsetWidth){
                                    return
                                }
                            }
                            let angle = this.angle(exy, nxy)
                            if(this.inAngle(angle, angleStart, angleEnd)){
                                let df, dist
                                if(angleEnd > angleStart){
                                    df = angleEnd - ((angleEnd - angleStart) / 2)
                                } else {
                                    df = angleEnd - (((angleEnd + 360) - angleStart) / 2)
                                    if(df < 0){
                                        df = 360 - df
                                    }
                                }
                                df = this.ndiff(df, angle)
                                dist = this.distance(exy, nxy, df)
                                if(this.debug){
                                    console.warn('POINTER', dist, df, e, n, exy, nxy, angle, direction, angleStart, angleEnd, traceback())
                                }
                                if(!closer || dist < closerDist){
                                    closer = n
                                    closerDist = dist
                                }
                            }
                        }
                    }
                })
            } else { // if none selected, pick anyone (first in items for now)
                closer = items[0]
                closerDist = 99999
            }
        }
        if(!closer){
            if(typeof(view.overScrollAction) != 'function' || view.overScrollAction(direction) !== true && noCycle !== true){
                closer = this.opposite(e, items, direction)                
                if(this.debug){
                    console.log('opposite', e, items, direction, closer)
                }
            }
        }
        if(closer){
            if(this.debug){
                console.warn('POINTER', closer, closerDist)
            }
            let pst = this._scrollContainer.scrollTop
            this.focus(closer)
            if(view.default){   
                this.lastScrollTop = this._scrollContainer.scrollTop
                if(this.lastScrollTop != pst){
                    this.scrollDirection = (this.lastScrollTop < pst) ? 'up' : 'down'
                    this.emit('scroll', this.lastScrollTop, this.scrollDirection)
                }
            } else {
                closer.scrollIntoViewIfNeeded({ behavior: 'smooth', block: 'nearest', inline: 'start' })
            }
        }
        this.emit('arrow', closer, direction)
    }
}

class ExplorerModal extends ExplorerPointer {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.inputHelper = new ExplorerURLInputHelper()
		this.modalTemplates = {}
		this.modalContainer = document.getElementById('modal')
		this.modalContent = this.modalContainer.querySelector('#modal-content')
		this.modalContent.parentNode.addEventListener('click', e => {	
            if(e.target.id == 'modal-content'){
				if(!this.inModalMandatory()){
					this.endModal()
				}
            }	
		})
	}
	plainText(html) {
		var temp = document.createElement('div');
		temp.innerHTML = html;
		return temp.textContent; // Or return temp.innerText if you need to return only visible text. It's slower.
	}
	inModal(){
		return this.body.hasClass('modal')
	}
	inModalMandatory(){
		return this.inModal() && this.body.hasClass('modal-mandatory')
	}
	startModal(content, mandatory){
		sound('warn', 16)
		this.emit('pre-modal-start')
		this.modalContent.innerHTML = content
		this.body.addClass('modal')
		mandatory && this.body.addClass('modal-mandatory')
		this.inputHelper.start()
		this.reset()
	}
	endModal(){
		if(this.inModal()){
			if(this.debug){
				console.log('ENDMODAL', traceback())
			}
			this.inputHelper.stop()
			this.body.removeClass('modal modal-mandatory')
			this.emit('modal-end')
			setTimeout(() => this.emit('pos-modal-end'), 100)
		}
	}
	replaceTags(text, replaces, noSlashes) {
		Object.keys(replaces).forEach(before => {
			let t = typeof(replaces[before])
			if(['string', 'number', 'boolean'].indexOf(t) != -1){
				let addSlashes = typeof(noSlashes) == 'boolean' ? !noSlashes : (t == 'string' && replaces[before].indexOf('<') == -1)
				text = text.split('{' + before + '}').join(addSlashes ? this.addSlashes(replaces[before]) : String(replaces[before]))
				if(text.indexOf("\r\n") != -1){
					text = text.replace(new RegExp('\r\n', 'g'), '<br />')
				}
			}
		})
		text = text.replace(new RegExp('\\{[a-z\\-]+\\}', 'g'), '')
		return text
	}  
	addSlashes(text){
		return String(text || '').replace(new RegExp('"', 'g'), '&quot;')
	}
}

class ExplorerPlayer extends ExplorerModal {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
	}
	inPlayer(){
		return typeof(streamer) != 'undefined' && streamer.active
	}
	isExploring(){
		return !this.inModal() && (!this.inPlayer() || this.body.hasClass('menu-playing'))
	}
}

class ExplorerFx extends ExplorerPlayer {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.fxContainer = this.container.find('wrap')
		//this.fxContainer.parent().css('perspective', '10vmin')
		//this.fxContainer.css('transform-origin', 'center bottom')
		this.on('pre-render', (newPath, oldPath) => {
			if(typeof(oldPath) != 'string'){
				oldPath = -1
			}
			if(newPath != oldPath){
				if(oldPath == -1 || newPath.length >= oldPath.length){
					this.fxNavIn()
				} else {
					this.fxNavOut()
				}
			}
		})
	}
	fxNavIn(){
		let deg = '-'+ (config['fx-nav-intensity'] * 0.45) + 'deg'
		this.fxContainer.css('transition', 'none')
		//this.fxContainer.css('transform', 'rotateX('+ deg +') scale(var(--explorer-fx-nav-deflate))')
		this.fxContainer.css('transform', 'scale(var(--explorer-fx-nav-deflate))')
		setTimeout(() => {
			this.fxContainer.css('transition', 'transform var(--explorer-fx-nav-duration) ease-in-out 0s')
			this.fxContainer.css('transform', 'none')
		}, 0)
	}
	fxNavOut(){
		let deg = (config['fx-nav-intensity'] * 0.3) + 'deg'
		this.fxContainer.css('transition', 'none')
		//this.fxContainer.css('transform', 'rotateX('+ deg +') scale(var(--explorer-fx-nav-inflate))')
		this.fxContainer.css('transform', 'scale(var(--explorer-fx-nav-inflate))')
		setTimeout(() => {
			this.fxContainer.css('transition', 'transform var(--explorer-fx-nav-duration) ease-in-out 0s')
			this.fxContainer.css('transform', 'none')
		}, 0)
	}
}


class ExplorerDialogQueue extends ExplorerFx {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.dialogQueue = []
		this.on('pos-modal-end', this.nextDialog.bind(this))
	}	
	queueDialog(cb){
		this.dialogQueue.push(cb)
		this.nextDialog()
	}
	nextDialog(){
		if(!this.inModal() && this.dialogQueue.length){
			let next = this.dialogQueue.shift()
			next()
		}
	}
}

class ExplorerDialog extends ExplorerDialogQueue {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.lastSelectTriggerer = false
		this.modalTemplates['option'] = `
			<a href="javascript:;" class="modal-template-option" id="modal-template-option-{id}" title="{plainText}" aria-label="{plainText}">
				{tag-icon}
				<div>
					<div>
						{text}
					</div>
				</div>
			</a>
		`
		this.modalTemplates['option-detailed'] = `
			<a href="javascript:;" class="modal-template-option-detailed" id="modal-template-option-detailed-{id}" title="{plainText}" aria-label="{plainText}">
				<div>
					<div class="modal-template-option-detailed-name">
						{tag-icon} {text}
					</div>
					<div class="modal-template-option-detailed-details">{details}</div>
				</div>
			</a>
		`
		this.modalTemplates['options-group'] = `
			<div class="modal-template-options">
				{opts}
			</a>
		`
		this.modalTemplates['text'] = `
			<span class="modal-template-text" id="modal-template-option-{id}">
				<i class="fas fa-caret-right"></i>
				<input type="text" placeholder="{placeholder}" value="{text}" aria-label="{plainText}" />
			</span>
		`
		this.modalTemplates['textarea'] = `
			<span class="modal-template-textarea" id="modal-template-option-{id}">
				<span>
					<span>
						<i class="fas fa-caret-right"></i>
					</span>
				</span>
				<textarea placeholder="{placeholder}" rows="3" aria-label="{plainText}">{text}</textarea>
			</span>
		`
		this.modalTemplates['message'] = `
			<span class="modal-template-message" aria-label="{plainText}">
				{text}
			</span>
		`
		this.modalTemplates['slider'] = `
			<span class="modal-template-slider" id="modal-template-option-{id}">
				<span class="modal-template-slider-left"><i class="fas fa-caret-left"></i></span>
				<input type="range" class="modal-template-slider-track" aria-label="{plainText}" />
				<span class="modal-template-slider-right"><i class="fas fa-caret-right"></i></span>
			</span>
		`
		this.modalTemplates['question'] = `
			<span class="modal-template-question" aria-label="{plainText}">
				{tag-icon}{text}
			</span>
		`
		this.modalTemplates['spacer'] = `
			<span class="modal-template-spacer">&nbsp;</span>
		`
	}
	text2id(txt){
		return Base64.encode(txt).toLowerCase().replace(new RegExp('[^a-z0-9]+', 'gi'), '')
	}
	dialog(entries, cb, defaultIndex, mandatory){
		this.queueDialog(() => {
			console.log('DIALOG', entries, cb, defaultIndex, mandatory, traceback())
			let html = '', opts = '', complete, callback = k => {
				complete = true
				if(this.debug){
					console.log('DIALOG CALLBACK', k, parseInt(k), traceback())
				}
				// k = parseInt(k)
				if(k == -1){
					k = false
				}
				if(k == 'submit'){
					let el = this.modalContainer.querySelector('input, textarea')
					if(el){
						k = el.value
					}
				}
				this.endModal()
				if(typeof(cb) == 'function'){
					cb(k)
				} else if(typeof(cb) == 'string'){
					cb = [cb, k]
					if(this.debug){
						console.warn('STRCB', cb)
					}
					this.app.emit.apply(this.app, cb)
				} else if(Array.isArray(cb)){
					cb.push(k)
					if(this.debug){
						console.warn('ARRCB', cb)
					}
					this.app.emit.apply(this.app, cb)
				}
			}
			let validatedDefaultIndex
			entries.forEach(e => {
				let template = e.template, isOption = ['option', 'option-detailed', 'text', 'slider'].includes(template)
				if(template == 'option' && e.details){
					template = 'option-detailed'
				}
				let tpl = this.modalTemplates[template]
				e['tag-icon'] = ''
				if(e.fa){
					if(e.fa.indexOf('//') == -1){
						e['tag-icon'] = '<i class="'+ e.fa + '"></i> '
					} else {
						e['tag-icon'] = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=" style="background-image: url(&quot;'+ e.fa +'&quot;);"> '
					}
				}
				if(!e.plainText){
					e.plainText = this.plainText(e.text)
				}
				e.text = e.text.replaceAll('"', '&quot;')
				e.plainText = e.plainText.replaceAll('"', '')
				tpl = this.replaceTags(tpl, e, true)
				if(this.debug){
					console.log(tpl, e)
				}
				if(isOption){
					if(!validatedDefaultIndex || e.id == defaultIndex){
						validatedDefaultIndex = e.id
					}
					opts += tpl
				} else {
					html += tpl
				}
			})
			if(opts){
				html += this.replaceTags(this.modalTemplates['options-group'], {opts}, true)
			}
			console.log('MODALFOCUS', defaultIndex, validatedDefaultIndex)
			this.startModal('<div class="modal-wrap"><div>' + html + '</div></div>', mandatory)
			let m = this.modalContent
			entries.forEach(e => {
				let p = m.querySelector('#modal-template-option-' + e.id+', #modal-template-option-detailed-' + e.id)
				if(p){
					if(['option', 'option-detailed'].includes(e.template)){
						p.addEventListener('click', () => {
							let id = e.oid || e.id
							console.log('OPTCLK', id)
							callback(id)
						})
					}
					if(String(e.id) == String(validatedDefaultIndex)){						
						setTimeout(() => {
							console.log('MODALFOCUS', document.activeElement, p, defaultIndex)
							this.focus(p, false)
						}, 150)
						setTimeout(() => {
							console.log('MODALFOCUS', document.activeElement, p, defaultIndex)
							this.focus(p, false)
						}, 400)
						setTimeout(() => {
							console.log('MODALFOCUS', document.activeElement, p, defaultIndex)
							this.focus(p, false)
						}, 800)
					}
				}
			})
			this.on('modal-end', () => {
				if(!complete){
					callback(-1)
				}
			})
			this.emit('dialog-start')
		})
	}
	info(title, text, cb){
		this.queueDialog(() => {
			let complete, mpt = [
				{template: 'question', text: title, fa: 'fas fa-info-circle'},
				{template: 'message', text},
				{template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
			];
			this.dialog(mpt, id => {
				if(this.debug){
					console.log('infocb', complete)
				}
				if(!complete){
					complete = true
					this.endModal()
					if(typeof(cb) == 'function'){
						cb()
					}
				}
				return true
			}, 'submit')
		})
	}
}

class ExplorerSelect extends ExplorerDialog {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
	}
	select(question, entries, fa, callback){
		let def, map = {}
		if(this.debug){
			console.warn('SELECT', entries)
		}
		this.dialog([
			{template: 'question', text: question, fa}
		].concat(entries.map(e => {
			e.template = 'option'
			if(!e.text){
				e.text = String(e.name)
			}
			e.id = this.text2id(e.text)
			map[e.id] = e.text
			if(e.selected){
				e.fa = 'fas fa-check-circle'
				def = e.id
			}
			return e
		})), k => {
			if(typeof(map[k]) != 'undefined'){
				k = map[k]
			}
			callback(k)
			this.endModal()
			this.emit('select-end', k)
		}, def)
		this.emit('select-start')
	}
}

class ExplorerOpenFile extends ExplorerSelect {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.openFileDialogChooser = false
	}	
	openFile(uploadURL, cbID, accepts){
		if(!this.openFileDialogChooser){ // JIT
			this.openFileDialogChooser = this.j('<input type="file" />')
			this.body.append(this.openFileDialogChooser)			
		}
		this.openFileDialogChooser.get(0).value = ""
		if(accepts){
			this.openFileDialogChooser.attr("accept", accepts)
		} else {
			this.openFileDialogChooser.removeAttr("accept")
		}
		this.openFileDialogChooser.off('change')
		this.openFileDialogChooser.on('change', (evt) => {
			if(this.openFileDialogChooser.get(0).files.length && this.openFileDialogChooser.get(0).files[0].name){
				this.sendFile(uploadURL, this.openFileDialogChooser.get(0).files[0], this.openFileDialogChooser.val(), cbID)
			} else {
				console.error('Bad upload data')
				osd.show('Bad upload data', 'fas fa-exclamation-circle', 'explorer', 'normal')
			}
		})
		this.openFileDialogChooser.trigger('click')
		return this.openFileDialogChooser
	}
	sendFile(uploadURL, fileData, path, cbID){
		console.warn('FILESEND', fileData, path)
		let formData = new FormData()
		if(cbID){
			formData.append('cbid', cbID)
		}
        formData.append('filename', fileData)
        formData.append('fname', fileData.name)
        formData.append('location', path)
        this.j.ajax({
            type: "POST",
            url: uploadURL,
            data: formData,
            cache: false,
			processData: false,  // tell jQuery not to process the data
			contentType: false   // tell jQuery not to set contentType
		})
	}
}

class ExplorerPrompt extends ExplorerOpenFile {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
	}
	prompt(question, placeholder, defaultValue, callback, multiline, fa, message, extraOpts){
		if(this.debug){
			console.log('PROMPT', {question, placeholder, defaultValue, callback, multiline, fa, extraOpts})
		}
		let p, opts = [
			{template: 'question', text: question, fa}
		];
		if(message){
			opts.splice(1, 0, {template: 'message', text: message})
		}
		opts.push({template: multiline === 'true' ? 'textarea' : 'text', text: defaultValue, id: 'text', placeholder})
		if(Array.isArray(extraOpts) && extraOpts.length){
			opts = opts.concat(extraOpts)
		} else {
			opts.push({template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'})
		}
		this.dialog(opts, id => {
			let ret = true
			if(this.debug){
				console.log('PROMPT CALLBACK', id, callback, typeof(callback))
			}
			if(typeof(callback) == 'function'){
				ret = callback(id)
			} else if(typeof(callback) == 'string'){
				callback = [callback, id]
				if(this.debug){
					console.warn('STRCB', callback)
				}
				this.app.emit.apply(this.app, callback)
			} else if(Array.isArray(callback)){
				callback.push(id)
				if(this.debug){
					console.warn('ARRCB', callback)
				}
				this.app.emit.apply(this.app, callback)
			}
			if(ret !== false){
				this.endModal()
				this.emit('prompt-end', id)
			}
		}, config['communitary-mode-lists-amount'])
		this.inputHelper.stop()

		this.emit('prompt-start')

		p = this.modalContent.querySelector('#modal-template-option-submit')
		p.addEventListener('keypress', (event) => {
			if(this.debug){
				console.log(event.keyCode)
			}
			if (event.keyCode != 13) {
				arrowUpPressed()
			}
		})
		arrowUpPressed()
		setTimeout(() => {
			this.inputHelper.start()
		}, 200)
	}
}

class ExplorerSlider extends ExplorerPrompt {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
	}
	sliderSetValue(element, value, range, mask){
		var n = element.querySelector('.modal-template-slider-track')
		if(this.debug){
			console.warn('BROOW', n.value, value, traceback())
		}
		n.value = value
		this.sliderSync(element, range, mask)
	}
	sliderVal(element, range){
		var n = element.querySelector('.modal-template-slider-track'), value = parseInt(n.value)
		return value
	}
	sliderSync(element, range, mask){
		var l, h, n = element.querySelector('.modal-template-slider-track'), t = (range.end - range.start), step = 1, value = parseInt(n.value)
		//console.warn('SLIDERSYNC', element, range, mask, step, value, this.sliderVal(element, range))
		if(value < range.start){
			value = range.start
		} else if(value > range.end){
			value = range.end
		}
		if(this.debug){
			console.warn('SLIDER VALUE A', element, element.querySelector('.modal-template-slider-track').value, n.value)
		}
		h = element.parentNode.parentNode.querySelector('.modal-template-question')
		h.innerHTML = h.innerHTML.split(': ')[0] + ': '+ (mask ? mask.replace(new RegExp('\\{0\\}'), value || '0') : (value || '0'))
		if(this.debug){
			console.warn('SLIDER VALUE B', value, '|', n, n.style.background, l, t, range, step, n.value)
		}
		if(value <= range.start){
			element.querySelector('.fa-caret-left').style.opacity = 0.1
			element.querySelector('.fa-caret-right').style.opacity = 1
		} else if(value >= range.end){
			element.querySelector('.fa-caret-left').style.opacity = 1
			element.querySelector('.fa-caret-right').style.opacity = 0.1
		} else {
			element.querySelector('.fa-caret-left').style.opacity = 1
			element.querySelector('.fa-caret-right').style.opacity = 1
		}
	}
	sliderIncreaseLeft(e, value, range, mask, step){
		if(this.debug){
			console.warn(e, value)
		}
		if(value >= range.start){
			value -= step
			if(value < range.start){
				value = range.start
			}
		}
		value = parseInt(value)
		this.sliderSetValue(e, value, range, mask)
		return value
	}
	sliderIncreaseRight(e, value, range, mask, step){
		if(value <= range.end){
			value += step
			if(value > range.end){
				value = range.end
			}
		}
		value = parseInt(value)
		this.sliderSetValue(e, value, range, mask)
		return value
	}
	slider(question, range, value, mask, callback, fa){
		let m, s, n, e, step = 1
		this.dialog([
			{template: 'question', text: question, fa},
			{template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'submit'}
		], ret => {
			if(ret !== false){
				ret = this.sliderVal(e, range)
				if(callback(ret) !== false){
					this.endModal()
					this.emit('slider-end', ret, e)
				}
			}
		}, '')

		s = this.j(this.modalContent.querySelector('#modal-template-option-submit'))
		s.before(this.modalTemplates['slider'])
		s.on('keydown', event => {
			switch(event.keyCode) {
				case 13:  // enter
					s.get().submit()
					break
				case 37: // left
					event.preventDefault()
					value = this.sliderIncreaseLeft(e, value, range, mask, step)
					break
				case 39:  // right
					event.preventDefault()
					value = this.sliderIncreaseRight(e, value, range, mask, step)
					break
			}
		})
		n = this.modalContent.querySelector('.modal-template-slider-track')
		e = n.parentNode
		if(this.debug){
			console.warn('SLIDER VAL', e, n)
		}
		this.emit('slider-start')
		n.setAttribute('min', range.start)
		n.setAttribute('max', range.end)
		n.setAttribute('step', step)
		n.addEventListener('input', () => {
			this.sliderSync(e, range, mask)
		})
		n.addEventListener('change', () => {
			this.sliderSync(e, range, mask)
		})
		n.parentNode.addEventListener('keydown', event => {
			console.log('SLIDERINPUT', event, s)
			switch(event.keyCode) {
				case 13:  // enter
					s.get(0).click()
					break
			}
		})
		this.sliderSetValue(e, value, range, mask)
		this.modalContent.querySelector('.modal-template-slider-left').addEventListener('click', event => {
			value = this.sliderIncreaseLeft(e, value, range, mask, step)
		})
		this.modalContent.querySelector('.modal-template-slider-right').addEventListener('click', event => {
			value = this.sliderIncreaseRight(e, value, range, mask, step)
		})
	}
}

class ExplorerStatusFlags extends ExplorerSlider {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.statusFlags = {}
		this.on('render', this.processStatusFlags.bind(this))
		this.on('update-range', this.processStatusFlags.bind(this))
		this.app.on('set-status-flag', (url, flag) => {
			if(this.debug){
				console.warn('SETFLAGEVT', url, flag)
			}
			this.setStatusFlag(url, flag)
		})
		this.app.on('sync-status-flags', data => {
			if(this.debug){
				console.warn('SYNCSTATUSFLAGS', data)
			}
			Object.keys(data).forEach(url => {
				this.setStatusFlag(url, data[url], true)
			})
			this.processStatusFlags()
		})
	}
	setStatusFlag(url, flag, skipProcessing){	
		if(url){
			if(typeof(this.statusFlags[url]) == 'undefined' || this.statusFlags[url] != flag){
				this.statusFlags[url] = flag
				if(skipProcessing !== true){
					this.processStatusFlags()
				}
			}
		}
	}
	processStatusFlags(){
		this.currentEntries.forEach((e, i) => {
			if(!this.ranging || (i >= this.range.start && i <= this.range.end)){
				if(e.url && typeof(this.statusFlags[e.url]) != 'undefined'){
					let element = this.currentElements[i], status = this.statusFlags[e.url]
					if(element && element.getAttribute('data-type') != 'spacer'){
						let content = ''
						if(status == 'tune'){
							content = '<i class="fas fa-layer-group"></i>'
						} else if(status == 'folder') {
							content = '<i class="fas fa-folder-open"></i>'
						} else if(status == 'waiting') {
							content = '<i class="fas fa-clock"></i>'
						} else {
							if(status == 'offline') {
								content = '<span class="entry-status-flag entry-status-flag-failure"><i class="fas fa-times"></i></span>'
							} else if(config['status-flags-type']) {
								content = '<span class="entry-status-flag entry-status-flag-success">'+ status +'</span>'
							} else {
								content = '<span class="entry-status-flag entry-status-flag-success"><i class="fas fa-check"></i></span>'
							}
						}
						this[status == 'offline' ? 'addClass' : 'removeClass'](element, 'entry-disabled')
						if(content != element.getAttribute('data-status-flags-html')){
							element.setAttribute('data-status-flags-html', content)
							element.querySelector('.entry-status-flags').innerHTML = content
						}
					}
				}
			}
		})
	}
}

class ExplorerLoading extends ExplorerStatusFlags {
	constructor(jQuery, container, app){
		super(jQuery, container, app)
		this.originalNames = {}
		this.app.on('set-loading', (data, active, txt) => {
			if(!data) return
			console.log('set-loading', data, active, txt)
			this.get(data).forEach(e => {
				this.setLoading(e, active, txt)
			})
		})
		this.app.on('unset-loading', () => {
			this.unsetLoading()
		})
		this.app.on('display-error', () => {
			this.unsetLoading()
		})
	}
	setLoading(element, active, txt){
		var e = this.j(element), c = e.find('.entry-name label')
		console.log('setLoading', element, c, active, txt)
		if(active){
			if(!e.hasClass('entry-loading')){
				if(!txt){
					txt = lang.OPENING
				}
				e.addClass('entry-loading')
				let t = c.html(), path = element.getAttribute('data-path')
				if(typeof(path) == 'string' && t != txt){
					this.originalNames[path] = t
					c.html(txt)
				}
			}
		} else {
			if(e.hasClass('entry-loading')){
				e.removeClass('entry-loading')
				let path = element.getAttribute('data-path')
				if(typeof(this.originalNames[path]) == 'string'){
					c.html(this.originalNames[path])
				}
			}
		}
	}
	unsetLoading(){ // remove any loading state entry
		this.container.find('a.entry-loading').each((i, e) => {
			this.setLoading(e, false)
		})
	}
}

class Explorer extends ExplorerLoading {
	constructor(jQuery, container, app){
		super(jQuery, container, app)	
		this.app.on('menu-playing', () => {			
			if(!this.body.hasClass('menu-playing')){
				this.body.addClass('menu-playing')
				setTimeout(() => this.reset(), 100)
			}
		})	
		this.app.on('render', (entries, path, icon) => {
			//console.log('ENTRIES', path, entries, icon)
			this.render(entries, path, icon)
		})
		this.app.on('explorer-select', (entries, path, icon) => {
			//console.log('ENTRIES', path, entries, icon)
			this.setupSelect(entries, path, icon)
		})
		this.app.on('info', (a, b, c, d) => {
			this.info(a, b, c, d)
		})
		this.app.on('dialog', (a, b, c, d) => {
			this.dialog(a, b, c, d)
		})
		this.app.on('dialog-close', (a, b, c, d) => {
			this.endModal()
		})
		this.app.on('prompt', (...args) => {
			this.prompt.apply(this, args)
		})
		this.initialized = false
		this.currentEntries = []
		this.currentElements = []
		this.range = {start: 0, end: 99}
		this.lastOpenedElement = null // prevent multi-click
		this.lastOpenedElementTime = null; // prevent multi-click
		['header', 'footer'].forEach(n => {
			this[n] = this.container.find(n)
		})
		this.icons = {
			'back': 'fas fa-chevron-left',
			'action': 'fas fa-cog',
			'slider': 'fas fa-cog',
			'input': 'fas fa-keyboard',
			'stream': 'fas fa-play-circle',
			'check': 'fas fa-toggle-off',
			'group': 'fas fa-folder-open'
		}
		this.ranging = false
		this.content = this.container.find('content')
		this.wrapper = this.content.find('wrap')
		this._wrapper = this.wrapper.get(0)
		this.templates = {
			default: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-original-icon="{fa}" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{prepend}{name}</label>
			</span>
			<span class="entry-details">{details}</span>
		</span>
		<span class="entry-icon-image">
			<i class="{fa}" aria-hidden="true"></i>
		</span>
	</span>
</a>`,
			spacer: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">
			<span class="entry-name" aria-hidden="true">
				<label>{name}</label>
			</span>
		</span>
		<span class="entry-icon-image">
			<i class="{fa}" aria-hidden="true"></i>
		</span>
	</span>
</a>`,
			input: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-default-value="{value}" data-original-icon="{fa}" data-question="{question}" data-path="{path}" data-type="{type}" data-multiline="{multiline}" data-placeholder="{placeholder}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{prepend}{name}</label>
			</span>
			<span class="entry-details">{details}</span>
		</span>
		<span class="entry-icon-image">
			<i class="{fa}" aria-hidden="true"></i>
		</span>
	</span>
</a>`,
			select: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-original-icon="{fa}" data-question="{question}" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">			
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{prepend}{name}</label>
			</span>
			<span class="entry-details">{details} {value}</span>
		</span>
		<span class="entry-icon-image">
			<i class="{fa}" aria-hidden="true"></i>
		</span>
	</span>
</a>`,
			slider: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-default-value="{value}" data-range-start="{range.start}" data-range-end="{range.end}" data-mask="{mask}" data-original-icon="{fa}" data-question="{question}" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">		
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{prepend}{name}</label>
			</span>
			<span class="entry-details">{value}</span>
		</span>
		<span class="entry-icon-image">
			<i class="{fa}" aria-hidden="true"></i>
		</span>
	</span>
</a>`,
			check: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-icon="" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">		
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{prepend}{name}</label>
			</span>
			<span class="entry-details">{details}</span>
		</span>
		<span class="entry-icon-image">
			<i class="fas fa-toggle-{checked} entry-logo-fa" aria-hidden="true"></i>
		</span>
	</span>
</a>`
		}                      
		this.app.on('trigger', data => {
			if(this.debug){
				console.warn('TRIGGER', data)
			}
			this.get(data).forEach(e => {
				e.click()
			})
		})                   
	}
	get(data){
		let ss = []
		if(data){
			let ks = Object.keys(data)
			if(ks.length){
				this.currentEntries.forEach((e, i) => {
					if(ks.every(k => data[k] == e[k])){
						ss.push(this.currentElements[i])
					}
				})
			}
		}
		return ss
	}
	diffEntries(a, b){
		let diff;
		['name', 'details', 'fa', 'type'].some(p => { // url comparing give false positives like undefined != javascript:;
			if(a[p] != b[p]){
				diff = p
				return true
			}
		})
		return diff
	}
	insertElementAt(e, i){
		if(i == 0){
			this.wrapper.prepend(e)
		} else {
			this.wrapper.find('a:nth-child('+ i +')').after(e)
		}
	}
	adaptiveRender(entries, path, prevEntries){
		let move
		entries.forEach((e, j) => {
			let ne
			if(!['select', 'check', 'slider'].includes(e.type)){
				prevEntries.some((n, i) => {
					let diff = this.diffEntries(e, n)
					if(!diff){
						ne = this.currentElements[i]
						if(i != j) {
							move = true
						}
						ne.setAttribute('tabindex', j)
						return true
					}
				})
			}
			if(!ne) {
				let tpl = this.templates['default']
				if(typeof(this.templates[e.type]) != 'undefined') {
					tpl = this.templates[e.type]
				}
				ne = jQuery(this.renderEntry(e, tpl, path)).get(0)
				move = true
			}
			if(!move) return
			this.insertElementAt(ne, j)
		})
		this.wrapper.find('a:gt('+ (entries.length - 1) +')').remove()
	}
	render(entries, path, icon){
		this.rendering = true
		clearTimeout(this.scrollingTimer)
		let html = '', targetScrollTop = 0
		if(typeof(this.selectionMemory[path]) != 'undefined') {
			targetScrollTop = this.selectionMemory[path].scroll
		}
		let prevEntries, useAdaptiveRender = path == this.path
		if(useAdaptiveRender) {
			prevEntries = this.currentEntries
		}
		this.currentEntries = entries
		entries = this.getRange(targetScrollTop)
		this.emit('pre-render', path, this.path)
		this.path = path
		this.lastOpenedElement = null
		if(useAdaptiveRender) {
			this.adaptiveRender(entries, path, prevEntries)
			prevEntries = null
		} else {
			this._scrollContainer.style.minHeight = (targetScrollTop + this._scrollContainer.offsetHeight) + 'px' // avoid scrolling
			entries.forEach(e => {
				let tpl = this.templates['default']
				if(typeof(this.templates[e.type]) != 'undefined'){
					tpl = this.templates[e.type]
				}
				html += this.renderEntry(e, tpl, path)
			})
			css('span.entry-wrapper {visibility: hidden; }', 'explorer-render-hack')
			this._scrollContainer.scrollTo(0, targetScrollTop)
			this._wrapper.innerHTML = html
			this._scrollContainer.scrollTo(0, targetScrollTop)
		}
		this.currentElements = Array.from(this._wrapper.getElementsByTagName('a'))
		setTimeout(() => {
			this.restoreSelection() // keep it in this timer, or the hell gates will open up!
			this.rendering = false
			this.emit('render', this.path, icon)
        	if(!useAdaptiveRender) {
				this._scrollContainer.style.minHeight = 0
				css('span.entry-wrapper {visibility: inherit;}', 'explorer-render-hack')
			}
			if(!this.initialized){
				this.initialized = true
				this.emit('init')
			}
			this.restoreSelection() // redundant, but needed
		}, 0)
	}
	viewportRange(scrollTop, entriesCount){
		let limit = (this.viewSizeX * this.viewSizeY)
		if(this.currentElements.length){ // without elements (not initialized), we can't calc the element height
			if(typeof(scrollTop) != 'number'){
				scrollTop = wrap.scrollTop
			}
			if(typeof(entriesCount) != 'number'){
				entriesCount = this.currentElements.length
			}
			let entryHeight = this.currentElements[0].offsetHeight
			let i = Math.round(scrollTop / entryHeight) * this.viewSizeX
			return {start: i, end: Math.min(i + limit, entriesCount - 1)}
		} else {
			return {start: 0, end: limit}
		}
	}
	viewportEntries(onlyWithIcons){
		let ret = [], as = this.currentElements
		if(as.length){
			let range = this.viewportRange()
			ret = as.slice(range.start, range.end)
			if(onlyWithIcons){
				ret = ret.filter(a => {
					return a.getAttribute('data-icon')
				})
			}
		}
		return ret
	}
    getRange(targetScrollTop){
		if(typeof(targetScrollTop) != 'number'){
			targetScrollTop = this._wrapper.scrollTop
		}
		this.ranging = false
		let entries = [], tolerance = this.viewSizeX, vs = Math.ceil(this.viewSizeX * this.viewSizeY), minLengthForRanging = vs + (tolerance * 2), shouldRange = config['show-logos'] && this.currentEntries.length >= minLengthForRanging
		if(targetScrollTop == 0){
			this.range = {start: 0, end: vs}
		} else {
			this.range = this.viewportRange(targetScrollTop, this.currentEntries.length)
			this.range.end = this.range.start + (vs -1)
		}
		console.log('RANGE', targetScrollTop, shouldRange, this.range)
		if(shouldRange){
			let trange = Object.assign({}, this.range)
			trange.end += tolerance
			if(trange.start >= tolerance){
				trange.start -= tolerance
			}
			this.currentEntries.forEach((e, i) => {
				let lazy = i < trange.start || i > trange.end
				entries[i] = Object.assign({lazy}, e)
				if(lazy && !this.ranging) {
					this.ranging = true
				}
			})
		} else {
			entries = this.currentEntries.slice(0)
		}
        return entries
    }
	updateRange(y){
		if(this.ranging){
			var changed = [], shouldUpdateRange = config['show-logos'] && this.currentEntries.length > (this.viewSizeX * this.viewSizeY)
			if(shouldUpdateRange){
				let rgx = new RegExp('<img', 'i'), elements = this.currentElements, entries = this.getRange(y || this._wrapper.scrollTop)
				//console.log('selectionMemory upadeteRange', entries)
				if(this.debug){
					console.warn("UPDATING RANGE", entries, traceback())
				}
				entries.forEach(e => {
					let type = elements[e.tabindex].getAttribute('data-type')
					let update = e.lazy != (type == 'spacer')
					if(update && e.lazy){
						if(!elements[e.tabindex].innerHTML.match(rgx)){
							e.lazy = false
							update = false
						}
					}
					if(this.debug){
						console.warn(e.type, type, elements[e.tabindex], e.tabindex, this.selectedIndex)
					}
					if(update){
						if(e.lazy){
							e.type = 'spacer'
						}
						let tpl = this.templates['default']
						if(typeof(this.templates[e.type]) != 'undefined'){
							tpl = this.templates[e.type]
						}
						let n = this.j(this.renderEntry(e, tpl, this.path)).get(0)
						elements[e.tabindex].parentNode.replaceChild(n, elements[e.tabindex])
						changed.push(n)
					}
				})
				this.app.emit('explorer-update-range', this.range, this.path)
				if(changed.length){
					if(this.debug){
						console.warn('UPDATING', changed, this.selectedIndex, this.range)
						//console.log('selectionMemory updateRange', changed, this.selectedIndex, this.range, this._wrapper.scrollTop)
					}
					this.currentElements = Array.from(this._wrapper.getElementsByTagName('a'))
					this.emit('update-range', changed)
					if(this.selectedIndex < this.range.start || this.selectedIndex >= this.range.end){
						this.focus(this.currentElements[this.range.start], true)
					} else {
						this.focus(this.currentElements[this.selectedIndex], true)
					}
				}
			}
		}
	}
	delayedFocus(element, avoidScroll){
		setTimeout(() => {
			if(this.debug){
				console.warn('DELAYED FOCUS', element)
			}
			this.focus(element, avoidScroll)
		}, 50)
	}
	check(element){
		sound('switch', 12)
		var path = element.getAttribute('data-path'), value = !element.querySelector('.fa-toggle-on')
		element.querySelector('.entry-icon-image').innerHTML = '<i class="fas fa-toggle-'+ (value?'on':'off') +' entry-logo-fa" aria-hidden="true"></i>'
		if(this.debug){
			console.warn('NAVCHK', path, value)
		}
		this.app.emit('explorer-check', path, value)
	}
	setupInput(element){
		var path = element.getAttribute('data-path')
		var def = element.getAttribute('data-default-value') || ''
		var fa = element.getAttribute('data-original-icon') || ''
		var placeholder = element.getAttribute('data-placeholder') || ''
		var question = element.getAttribute('data-question') || element.getAttribute('title')
		var multiline = element.getAttribute('data-multiline') || false
		this.prompt(question, placeholder, def, value => {
			if(value !== false && value != -1){
				if(this.debug){
					console.warn('NAVINPUT', path, value)
				}
				this.app.emit('explorer-input', path, value)
				element.setAttribute('data-default-value', value)
				this.emit('input-save', element, value)
			}
			this.delayedFocus(element, true)
		}, multiline, fa)
	}
	setupSelect(entries, path, fa){
		const element = this.container.find('[data-path="'+ path.replaceAll('"', '&quot;') +'"]').eq(0)
		if(element && element.length){
			let icon = element.find('img')
			if(icon && icon.length){
				icon = icon.css('background-image')
				if(icon){
					icon = icon.match(new RegExp('url\\([\'"]*([^\\)\'"]*)', 'i'))
					if(icon){
						fa = icon[1]
					}
				}
			}
		}
		this.select(path.split('/').pop(), entries, fa, retPath => {
			console.warn('NAVSELECT', path, entries, retPath)
			if(retPath){
				if(this.debug){
					console.warn('NAVSELECT', path, entries, retPath)
				}
				let actionPath = path +'/'+ retPath
				entries.some(e => {
					if(e.name == retPath){						
						if(e.path){
							actionPath = e.path
						}
						return true
					}
				})
				this.app.emit('explorer-open', actionPath)
				if(element){
					element.attr('data-default-value', retPath)
				}
			}
			this.delayedFocus(this.lastSelectTriggerer, true)
		})
	}
	setupSlider(element){
		var path = element.getAttribute('data-path')
		var start = parseInt(element.getAttribute('data-range-start') || 0)
		var end = parseInt(element.getAttribute('data-range-end') || 100)
		var mask = element.getAttribute('data-mask')
		var def = element.getAttribute('data-default-value') || ''
		var fa = element.getAttribute('data-original-icon') || ''
		var question = element.getAttribute('data-question') || element.getAttribute('title')
		this.slider(question, {start, end}, parseInt(def || 0), mask, value => {
			if(value !== false){
				if(this.debug){
					console.warn('NAVINPUT', path, value)
				}
				this.app.emit('explorer-input', path, value)
				element.setAttribute('data-default-value', value)
				this.emit('input-save', element, value)
			}
			this.delayedFocus(element, true)
		}, fa)
	}
	open(element){
		this.focus(element, true)
		let timeToLock = 3, path = element.getAttribute('data-path'), type = element.getAttribute('data-type'), tabindex = element.tabIndex || 0
		if(type == 'spacer'){
			type = this.currentEntries[tabindex].type
		}
		if(this.lastOpenedElement == element && ['back', 'stream', 'group'].includes(type) && ((this.lastOpenedElementTime + timeToLock) > time())){
			if(this.debug){
				console.log('multi-click prevented')
			}
			return
		}
		this.lastOpenedElement = element
		this.lastOpenedElementTime = time()
		this.j(element).one('blur', () => {
			this.lastOpenedElement = null
		})
		switch(type){
			case 'back':
				sound('click-out', 3)
				break
			case 'group':
				sound('click-in', 4)
				break
			case 'stream':
				sound('warn', 16)
				break
		}
		if(tabindex == '{tabindex}'){
			tabindex = false
		}
		if(type == 'back'){
			path = path.split('/')
			path.pop()
			path.pop()
			path = path.join('/')
			this.setLoading(element, true, lang.RETURNING)
		} else if(type == 'group'){
			this.setLoading(element, true)
		}
		if(this.debug){
			console.warn('explorer-open', path, type, tabindex || false)
		}
		this.emit('open', type, path, element, tabindex || false)
		if(type == 'action'){
			this.app.emit('explorer-action', path, tabindex || false)
		} else if(type == 'back'){
			this.app.emit('explorer-back')
		} else if(type == 'select'){
			this.lastSelectTriggerer = element
			this.app.emit('explorer-select', path, tabindex || false)
		} else {
			this.app.emit('explorer-open', path, tabindex || false)
		}
	}
	action(event, element){
		let type = element.getAttribute('data-type')
		console.log('action', type, event, element)
		switch(type){
			case 'input':
				this.setupInput(element)
				break
			case 'slider':
				this.setupSlider(element)
				break
			case 'check':
				this.check(element)
				break
			default:
				if(type == 'select'){
					this.lastSelectTriggerer = this
				}
				this.open(element)
		}
		event.preventDefault()
		event.stopPropagation()
		return false
	}
	triggerAction(path, name){
		return new Promise((resolve, reject) => {
			let failed, timer = 0
			this.once('render', p => {
				if(failed){
					return
				}
				clearTimeout(timer)
				if(p == path){
					let n = -1
					this.currentEntries.some((e, i) => {
						if(e.name == name){
							n = i 
							return true
						}
					})
					if(n != -1){
						this.currentElements[n].click()
						resolve(true)
					} else {
						reject('option not found')
					}
				} else {
					reject('navigation failed')
				}
			})
			this.app.emit('explorer-open', path)
			timer = setTimeout(() => {
				failed = true
				reject('timeout')
			}, 5000)
		})
	}
	prepareEntry(e, path){
		if(!e.url){
			e.url = 'javascript:;'
		}
		if(!e.type){
			e.type = typeof(e.url) ? 'stream' : 'action'
		}
		if(!e.fa){
			if(!e.icon || e.icon.indexOf('fa-') == -1){
				if(this.icons[e.type]){
					e.fa = 'fas ' + this.icons[e.type]
				}
			} else {
				e.fa = e.icon
			}
		}
		if(!e.path){
			e.path = path
			if(e.path){
				e.path +=  '/'
			}
			e.path += e.name
		}
		return e
	}
	renderEntry(e, tpl, path){
		e = this.prepareEntry(e, path)
		var reps = {}
		Object.keys(e).forEach(k => {
			if(k == 'range') {
				reps['range.start'] = e[k].start || 0
				reps['range.end'] = e[k].end || 100
			} else if (k == 'value' && typeof(e['mask']) != 'undefined') {
				reps[k] = e.mask.replace('{0}', e[k])
			} else {
				reps[k] = e[k] || ''
			}
		})
		if(e.type && e.type == 'check'){
			reps['checked'] = e['value'] ? 'on' : 'off'
		}
		tpl = this.replaceTags(tpl, reps)
		if(e.color){
			tpl = tpl.replace(new RegExp('<i ', 'i'), '<i style="color: ' + e.color + ';" ')
		}
		return tpl
	}
}