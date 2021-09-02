


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
		this.on('open', (type, path, element, tabindex) => {
			//if(type == 'group'){
				this.selectionMemory[this.path] = {scroll: this._wrapper.scrollTop, index: this.selectedIndex}
			//}
		})
		this.on('arrow', (type, path, element, tabindex) => {
			//if(type == 'group'){
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
		this.updateSelectionCB(this.path, '', true)
	}
	updateSelectionCB(path, icon){
		if(this.isExploring()){
            this.scrollDirection = ''
            this.scrollSnapping = true
			let target = 0, index = 1, isSearch = path.split('/').pop() == lang.SEARCH
			if(isSearch){
                this._scrollContainer.scrollTop = target
                this.focusIndex(index)
                this.scrollSnapping = false
            } else {
                this.touchMoving = false
				this.restoreSelection()
			}
		}
    }
    restoreSelection(){
        let data = {scroll: 0, index: this.path ? 1 : 0}
        if(typeof(this.selectionMemory[this.path]) != 'undefined'){
            data = this.selectionMemory[this.path]
            if(data.index == 0 && this.path){
                data.index = 1
            }
        }
        console.log('EXP RESTORE', data, this.path)
        this._scrollContainer.scrollTop = data.scroll
        if(this.activeView().level == 'default'){
            this.focusIndex(data.index, true) // true = force re-selecting the same entry on refresh
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
        this.mouseWheelMovingInterval = 200
        this.touchMoving = false
        this.touchMovingTimer = 0
        this.scrollDirection = 'down'
        this.lastScrollTop = 0;
        ['touchmove', 'scroll', 'mousewheel', 'DOMMouseScroll'].forEach(n => {
            this.scrollContainer.on(n, event => {
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
                // console.log('pointer.scroll', n, this.scrollSnapping, isTrusted, event)
                if(this.scrollSnapping){
                    if(isTrusted){
                        this.scrollContainer.stop(true, false)
                    } else {
                        return
                    }
                }
                clearTimeout(this.touchMovingTimer)
                let st = this._scrollContainer.scrollTop
                if(st > this.lastScrollTop){
                    this.scrollDirection = 'down'
                } else if(st < this.lastScrollTop) {
                    this.scrollDirection = 'up'
                }
                if(this.lastScrollTop != st){
                    this.lastScrollTop = st   
                    if(['mousewheel', 'DOMMouseScroll'].indexOf(n) != -1){
                        this.touchMoving = false
                        let now = (new Date()).getTime()
                        if(now > (this.mouseWheelMovingTime + this.mouseWheelMovingInterval)){
                            this.mouseWheelMovingTime = now
                            let delta = (event.originalEvent.wheelDelta || -event.originalEvent.detail)
                            console.log('mousewheel', delta)
                            this.arrow((delta > 0) ? 'up' : 'down', true)
                            this.emit('scroll', this.lastScrollTop, this.scrollDirection)
                        }
                        event.preventDefault()
                    } else {   
                        this.touchMoving = true
                        this.touchMovingTimer = setTimeout(() => {
                            if(this.rendering){
                                return
                            }
                            if(this.touchMoving){
                                this.touchMoving = false
                            }
                            this.scrollSnap(this.lastScrollTop, this.scrollDirection, () => {
                                if(this.rendering){
                                    return
                                }
                                this.emit('scroll', this.lastScrollTop, this.scrollDirection)
                            })
                        }, 100)
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
    }
    isVisible(e) {
        return (e.offsetParent !== null)
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
    focusIndex(a, force){
        if(force || a != this.selectedIndex){
            a = this.scrollContainer.find('a[tabindex="'+ (a ? a : '') +'"]').get(0)
            if(this.debug){
                console.log('FOCUSINDEX', a)
            }
            if(a){
                this.focus(a)
            }
        }
    }
    focus(a, noScroll){
        let ret = null        
        if(this.debug){
            console.log('focus', a, noScroll, traceback())
        }
        if(!a) {
            a = this.entries().shift()
        } else if(a instanceof this.j) {
            if(this.debug){
                console.error('focus received jQuery element', a, noScroll, traceback())
            }
            a = a.get(0)
        }
        if(a && !this.hasClass(a, this.className)){
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
                if(!noScroll) {
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


