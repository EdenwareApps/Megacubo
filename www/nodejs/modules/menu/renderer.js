import { EventEmitter } from 'events'
import { Sounds } from './sound'
import { main } from '../bridge/renderer'
import { css, time, traceback } from '../../renderer/src/scripts/utils'

class MenuURLInputHelper {
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
			this.bind(true)
			let e = this.getInputElement()
			if(e){
				e.select()
			}
        }
    }
    stop(){
        this.bind(false)
        this.active = false
    }
    bind(enable){
		let e
		const method = enable ? 'addEventListener' : 'removeEventListener'
		this.events.forEach((e, i) => {
			e = document.querySelector(this.events[i][0])
			if(e) e[method](this.events[i][1], this.events[i][2])
		})
    }
}

class MenuBase extends EventEmitter {
	constructor(container){
		super()
		console.log('Menu base', {container, main})		
		this.sounds = new Sounds()
		this.debug = false
		this.path = ''
		this.container = container
		this.wrap = container.querySelector('wrap')
		console.log('Menu base')
		container.addEventListener('click', event => {
			event.preventDefault()
			const a = event.target.closest('a')
			a && !a.classList.contains('entry-ignore') && this.action(a)
		})
		main.on('config', (_, c) => this.sounds.volume = c.volume)
	}
    buildElementFromHTML(code) {
        const wrap = document.createElement('span')
        wrap.innerHTML = code
        return wrap.firstElementChild
    }
}

class MenuIcons extends MenuBase {
	constructor(container) {
		super(container)
		this.icons = {'': {url: 'fas fa-home'}}
		this.defaultIcons = {
			'back': 'fas fa-chevron-left',
			'action': 'fas fa-cog',
			'slider': 'fas fa-cog',
			'input': 'fas fa-keyboard',
			'stream': 'fas fa-play-circle',
			'check': 'fas fa-toggle-off',
			'group': 'fas fa-box-open'
		}
		main.on('icon', data => {
			if(data.tabIndex == -1) return
			
			const fullPath = [data.path, data.name].filter(v => v).join('/')
			if(typeof(this.icons[fullPath]) == 'undefined') {
				this.icons[fullPath] = {}
			}

			let changed
			const isCover = !data.alpha
			if(this.icons[fullPath].cover != isCover) {
				this.icons[fullPath].cover = isCover
				changed = true
			}
			if(this.icons[fullPath].url != data.url) {
				this.icons[fullPath].url = data.url
				changed = true
			}
			
			if(changed) {
				let entries = this.currentEntries.map(e => this.prepareEntry(e))
				this.applyCurrentEntries(entries)
				this.uiUpdate(false)
			}
		})
	}
}

class MenuSelectionMemory extends MenuIcons {
	constructor(container){
		super(container)
		this.selectionMemory = {}
		this.on('open', () => {
			this.saveSelection()
		})
		this.on('focus', () => {
			this.saveSelection()
		})
		this.on('pre-render', () => {
			this.saveSelection()
		})
		this.on('pre-modal-start', () => {
			let e = this.selected()
			if(e && e.title){
				this.saveSelection()
			}
		})
        this.on('pos-modal-end', this.restoreSelection.bind(this))
		main.on('menu-reset-selection', () => {
            this.selectionMemory = {}
        })
		main.on('current-search', (terms, type) => {
            this.currentSearch = JSON.stringify({terms, type})
        })
	}
	saveSelection() {
		this.debug && console.error('saveSelection', this.wrap.scrollTop, this.selectedIndex, this.path)
		const n = this.currentViewName()
		if(!this.selectionMemory[this.path]) this.selectionMemory[this.path] = {}
		this.selectionMemory[this.path][n] = {
			scroll: n == 'default' ? this.wrap.scrollTop : 0,
			index: this.selectedIndex,
			search: this.currentSearch
		}
	}
	currentViewName() {
		return this.activeSpatialNavigationLayout().level
	}
    restoreSelection(){
		const n = this.currentViewName()
		const selected = this.selected()
		if(selected && selected.id == 'menu-search') return
        let data = {scroll: 0, index: this.path ? 1 : 0}
		const selectables = this.selectables()
		if(typeof(this.selectionMemory[this.path]) != 'undefined' && this.selectionMemory[this.path][n]) {
			const inSearch = this.path.indexOf(main.lang.SEARCH) != -1 || this.path.indexOf(main.lang.MORE_RESULTS) != -1 || this.path.indexOf(main.lang.SEARCH_MORE) != -1
			const inSameSearch = inSearch && this.currentSearch == this.selectionMemory[this.path][n].search
			if(!inSearch || inSameSearch) {
				data = this.selectionMemory[this.path][n]
				if(data.index == 0 && this.path){
					data.index = 1
				}
			}
        }
        this.debug && console.log('selectionMemory restore', data.scroll, data.index, this.path)
        if(this.activeSpatialNavigationLayout().level == 'default' && this.currentElements[data.index]){
			let range = this.viewportRange(data.scroll)
			if(data.index < range.start || data.index >= range.end){
				data.index = range.start
			}
			this.focus(this.currentElements[data.index], true)			
        	this.scrollTop(data.scroll, true)
			return true
        } else {
			selectables.includes(selected) || this.reset()
		}
    }
	scrollTop(y, raw){
        if(typeof(y) == 'number') {
			this.wrap.scroll({
				top: y,
				left: 0,
				behavior: raw ? 'instant' : 'smooth'
			})
		}
		return this.wrap.scrollTop
	}
}

class MenuSpatialNavigation extends MenuSelectionMemory {
    constructor(container){
        super(container)
		this.layouts = []
		this.defaultNavGroup = ''
        this.angleWeight = 0.0125 // 0.005
        this.className = 'selected'
        this.parentClassName = 'selected-parent'
        this.selectedIndex = 0
        this.mouseWheelMovingTime = 0
        this.mouseWheelMovingInterval = 300
        this.scrollingTimer = 0
        this.wrap.addEventListener('scroll', () => {
			this.resetScrollEmittingTimer(this.rendering)
        })
		this.wrap.addEventListener('touchstart', () => {
			this.wrap.style.scrollSnapType = 'none'
		})
		this.wrap.addEventListener('touchend', () => {
			this.wrap.style.scrollSnapType = 'y mandatory'
		})
		const resizeListener = () => this.resize()
		window.addEventListener('resize', resizeListener, { capture: true })
		window.addEventListener('orientationchange', resizeListener, { capture: true })
		screen.orientation && screen.orientation.addEventListener('change', resizeListener)
		this.once('render', this.adjustIconSize.bind(this))
		setTimeout(() => {
			this.setGridLayout(4, 3, 1, 8)
			resizeListener() // to apply initial icons size
		}, 0)
	}
	resetScrollEmittingTimer(clearOnly) {
		clearTimeout(this.scrollingTimer)
		if(clearOnly === true) return
		this.scrollingTimer = setTimeout(() => {
			if(this.debug){
				console.log('pointer.scroll', this.rendering)
			}
			if(this.rendering) return
			const done = () => {                                
				if(this.debug){
					console.log('pointer.scroll', this.rendering)
				}
				if(this.rendering) return
				this.emit('scroll', this.wrap.scrollTop)
			}
			done()
		}, 400)
	}
    setGridLayout(x, y, px, py){
        this._gridLayoutX = x
        this._gridLayoutY = y
        this._gridLayoutPortraitX = px
        this._gridLayoutPortraitY = py
        this.resize()
    }
    resize(){
        const portrait = (window.innerHeight > window.innerWidth)
        if (portrait) {
            this.gridLayoutX = this._gridLayoutPortraitX
            this.gridLayoutY = this._gridLayoutPortraitY
        } else {
            this.gridLayoutX = this._gridLayoutX
            this.gridLayoutY = this._gridLayoutY
        }
		const wide = main.config['view-size'][portrait ? 'portrait' : 'landscape'].x >= 3
        const verticalLayout = main.config['view-size'][portrait ? 'portrait' : 'landscape'].x == 1
        document.body.classList[wide ? 'add' : 'remove']('menu-wide')
		document.body.classList[verticalLayout ? 'add' : 'remove']('portrait')
		this.adjustIconSize()
		this.sideMenuSync(true)
    }
	adjustIconSize(){
		let e = document.querySelector('a:not(.entry-2x) .entry-icon-image')
		if(e){
			let metrics = e.getBoundingClientRect()
			if(metrics && metrics.width){
				let min = Math.min(metrics.width, metrics.height) * 0.85
				css(`

				#menu content a .entry-icon-image i {
    				font-size: ${min}px;
    				line-height: ${metrics.height}px;
    				min-height: ${metrics.height}px;
				}

				`, 'entry-icon-i')
			}
		}
	}
    isVisible(e) {
        return e.offsetParent !== null
    }
    selector(s){
        return Array.from(document.querySelectorAll(s)).filter(this.isVisible)
    }
    start(){
        document.body.addEventListener('focus', this.selected.bind(this))
        this.selected()
    }
    updateElement(element){ // if layout has changed, find the actual corresponding element
        if(!element.parentNode){
            let prop, val;
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
        let elements = [], layout = this.activeSpatialNavigationLayout() // is any explicitly selected??
        if(layout){
            if(typeof(layout.resetSelector) == 'function'){
                elements = layout.resetSelector()
            } else {
                elements = this.entries()
            }
        }
        return elements.filter(e => e.parentNode)
    }
	clearSelection(element){
		for(const e of document.querySelectorAll('.'+ this.className)) e.classList.remove(this.className)
		for(const e of document.querySelectorAll('.'+ this.parentClassName)) e.classList.remove(this.parentClassName)
		if(element){
			element.classList.add(this.className)
			element.parentNode && element.parentNode.classList.add(this.parentClassName)
		}
	}
    findSelected(deep){
        let elements, element = document.activeElement
		if(element == document.body) {
			element = document.querySelector('.'+ this.className)
		}
		if(!deep && element) return element
        if(element && element != document.body){ // not explicitly selected
            elements = this.selectables() // check if is any explicitly selected??
            let selected = elements.filter(e => e.classList.contains(this.className))
            if(selected.length){
                element = selected[0] // yes, that's one explicitly selected
            } else {
                element = this.updateElement(element) // find this element in current layout, if it's not
                if(!element.parentNode || !elements.includes(element)){ // not found, we'll reset so
                    element = false
                }
            }
        }
        if(!element || element == document || element == document.body){
            if(typeof(elements) == 'undefined'){
                elements = this.selectables()
            }
            let selected
			if(elements.length){
				try { // $.filter was triggering errors on some TV boxes, somehow
					selected = elements.filter(e => e.classList.contains(this.className))
				} catch(e) {}
			}
            if(selected && selected.length){
                element = selected[0] // yes, that's one explicitly selected
            } else {
                element = elements[0]
            }
        }
		if(element && element.id == 'menu-omni-input') {
			element = element.parentNode
		}
        if(this.debug){
            console.log('findSelected', element, elements)
        }
        return element
    } 
	selected(deep){
        let element = this.findSelected(deep)
        if(element){
        	element.classList.contains(this.className) || this.clearSelection(element)
            element.focus({preventScroll: true})
        }
        return element
    }
    focus(a, avoidScroll){
        let ret = null        
        this.debug && console.error('focus', a, avoidScroll, this.wrap.scrollTop)
        if(!a) {
            a = this.entries().shift()
        }
		const currentLayer = this.activeSpatialNavigationLayout().level
		if(a && (a != document.querySelector('.'+ this.className))) {
            if(this.debug){
                console.log('FOCUSENTRY', a)
            }
            this.clearSelection(a)
            let index = this.currentElements.indexOf(a)
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
            if(index == -1) { // is main menu or modal entry
				a.scrollIntoViewIfNeeded({behavior: 'instant'})
			} else {
                let lastIndex = this.selectedIndex
                this.selectedIndex = index
                if(this.debug) {
                    console.log('pointer selectedIndex =', a.tabIndex, a)
                }
				console.log('SCROLL', a.offsetTop, [this.wrap.scrollTop, this.wrap.offsetHeight])
				if(!avoidScroll && a.offsetTop > this.wrap.scrollTop && a.offsetTop <= (this.wrap.scrollTop + this.wrap.offsetHeight - 4)) {
					console.log('AVOID SCROLL', a.offsetTop, [this.wrap.scrollTop, this.wrap.offsetHeight])
					avoidScroll = true
				}
                if(!avoidScroll) {
                    if(lastIndex != this.selectedIndex) {
                        let s = a.offsetTop
						if(s < 0) {
                            s = 0
                        }
                        let t = a.offsetTop - (this.wrap.offsetHeight - a.offsetHeight)
						if(t && Math.abs(this.wrap.scrollTop - t) < Math.abs(this.wrap.scrollTop - s)) {
							s = t
						}
						if(s != this.wrap.scrollTop) {
							console.warn('pointer scrolling...', a.offsetTop, s, this.wrap.scrollTop)
                            this.scrollTop(s, true)
							ret = s
                        }
                    }
                }
            }
            this.emit('focus', a, index)
        } else {
			this.debug && console.log('Already focused', {currentLayer, a, selected: document.querySelector('.'+ this.className), avoidScroll, scrollLeft: this.container.scrollLeft, scrollTop: this.wrap.scrollTop})	
		}
        return ret
    }  
    activeSpatialNavigationLayout(){
        let ret = {selector: 'body', level: 'default'} // placeholder while no views are added
        this.layouts.some(layout => {
            if(!ret){
                ret = layout
            }
            if(layout.condition()){
                ret = layout
                return true
            }
        })
        return ret
    }
    reset(){        
        if(this.debug){
            console.log('reset')
        }
        let elements, layout = this.activeSpatialNavigationLayout()
        if(typeof(layout.resetSelector) == 'function'){
            elements = layout.resetSelector()
        } else {
            elements = this.entries()
        }
        if(elements.length && elements.indexOf(this.selected()) == -1){
            elements = elements.filter(e => e.getAttribute('data-type') != 'back').slice(0)
            if(elements.length){
                let _sound = this.sounds
                this.focus(elements[0], true)
                this.sounds = _sound
            }
        }
    }
    entries(noAsides){
		let e = [], layout = this.activeSpatialNavigationLayout(), sel = layout.selector
        if(typeof(sel)=='function'){
            sel = sel()
        }
        if(typeof(sel) == 'string'){
            e.push(...this.selector(sel))
        } else if(Array.isArray(sel)) {
            e.push(...sel)
        } else {
			console.error('Bad layer selector')
		}
		e = e.filter(n => {
            return !n.className || String(n.className).indexOf('menu-not-navigable') == -1 // Uncaught TypeError: n.className.indexOf is not a function
        })
		if(noAsides === true){
			e = e.filter(n => n.parentNode && n.parentNode == this.wrap)
		}
		return e
    }
    addSpatialNavigationLayout(layout){
        if(layout.default === true || !this.defaultNavGroup){
            this.defaultNavGroup = layout.level
        }
        return this.layouts.push(layout) // add.selector can be a selector string, set of elements or function returning elements
    }
    distance(c, e, m){
        let r = Math.hypot(e.left - c.left, e.top - c.top)
        if(m){
            r += r * (this.angleWeight * m)
        }
        return r
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
    isAngleWithinRange(angle, start, end){
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
                left: parseInt(c.left + (c.width / 2)), 
                top: parseInt(c.top + (c.height / 2))
            }
        }
    }
    opposite(selected, items, direction){
        let i, n = items.indexOf(selected), x = this.gridLayoutX, y = this.gridLayoutY
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
	angleCenter(angle1, angle2) {
		const diff = (angle2 - angle1 + 360) % 360
		const center = (angle1 + diff / 2) % 360
		return center < 0 ? center + 360 : center
	}
	angleDiff(angle1, angle2Start, angle2End){
		const angle2 = this.angleCenter(angle2Start, angle2End)
		const diff = Math.abs(angle1 - angle2)
		return Math.min(diff, 360 - diff)
	}
    arrow(direction, noCycle){
        let closer, closerDist, directionAngleStart, directionAngleEnd
		let items = this.entries(), layout = this.activeSpatialNavigationLayout(), e = this.selected()
		switch(direction){
			case 'up':
				directionAngleStart = 270
				directionAngleEnd = 90
				break
			case 'right':
				directionAngleStart = 0
				directionAngleEnd = 180
				break
			case 'down':
				directionAngleStart = 90
				directionAngleEnd = 270
				break
			case 'left':
				directionAngleStart = 180
				directionAngleEnd = 360
				break
		}
		const exy = this.coords(e)
		if(exy) {
			items.forEach(n => {
				if(n != e) {
					const nxy = this.coords(n)
					if(nxy) {
						if(['up', 'down'].includes(direction)) { // avoid bad horizontal moving
							if(nxy.top == exy.top && n.offsetHeight == e.offsetHeight){
								return
							}
						}
						if(['left', 'right'].includes(direction)) { // avoid bad vertical moving
							if(nxy.left == exy.left && n.offsetWidth == e.offsetWidth){
								return
							}
						}
						const angle = this.angle(exy, nxy)
						if(this.isAngleWithinRange(angle, directionAngleStart, directionAngleEnd)){
							const df = this.angleDiff(angle, directionAngleStart, directionAngleEnd)
							const dist = this.distance(exy, nxy, df)
							if(this.debug){
								console.warn('POINTER', dist, {df, angle, directionAngleStart, directionAngleEnd}, direction, e, n, exy, nxy)
							}
							if(!closer || dist < closerDist || 
								(n.parentNode == e.parentNode && closer.parentNode != e.parentNode)
								){
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
        if(!closer){
            if(noCycle !== true && (typeof(layout.overScrollAction) != 'function' || layout.overScrollAction(direction, e) !== true)){
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
            let previousScrollTop = this.wrap.scrollTop
            this.focus(closer)
            if(layout.default){   
                if (this.wrap.scrollTop != previousScrollTop) {
					this.emit('scroll', this.wrap.scrollTop)
				}
            } else {
                closer.scrollIntoViewIfNeeded({ behavior: 'smooth', block: 'nearest', inline: 'start' })
            }
        }
        this.emit('arrow', closer, direction)
    }
}

class MenuBBCode extends MenuSpatialNavigation {
	constructor(container){
		super(container)
		this.funnyTextColors = ['#3F0', '#39F', '#8d45ff', '#ff02c9', '#e48610']
		this.bbCodeMap = {
			'b': fragment => {
				if(fragment.substr(0, 2) == '[|'){
					return '</strong>'
				}
				return '<strong>'
			},
			'i': fragment => {
				if(fragment.substr(0, 2) == '[|'){
					return '</i>'
				}
				return '<i>'
			},
			'alpha': fragment => {
				if(fragment.substr(0, 2) == '[|'){
					return '</font>'
				}
				return '<font style="color: var(--secondary-font-color); text-shadow: none;">'
			},
			'color': (fragment, name) => {
				if(fragment.substr(0, 2) == '[|'){
					return '</font>'
				}
				let color = name.split(' ').slice(1).join(' ')
				return '<font style="color: '+ color +';">'
			}
		}

	}
	removeBBCode(text){
		return text.replace(new RegExp('\\[\\|?([^\\]]*)\\]', 'g'), '')
	}
	parseBBCode(text){
		if(typeof(this.replaceBBCodeFnPtr) == 'undefined'){
			this.replaceBBCodeRegex = new RegExp('\\[(fun|'+ Object.keys(this.bbCodeMap).join('|') +')')
			this.replaceBBCodeFnPtr = this.replaceBBCode.bind(this)
			this.replaceBBCodeFunnyTextFnPtr = this.replaceBBCodeFunnyText.bind(this)
		}
		if(text.match(this.replaceBBCodeRegex)) {
			text = text.replace(new RegExp('\\[fun\\]([^\\[]*)\\[\\|?fun\\]', 'gi'), this.replaceBBCodeFunnyTextFnPtr)
			return text.replace(new RegExp('\\[\\|?([^\\]]*)\\]', 'g'), this.replaceBBCodeFnPtr)
		}
		return text
	}
	replaceBBCode(fragment, name, i, text){
		const tag = name.split(' ').shift().toLowerCase()
		if(!this.bbCodeMap[tag]) {
			return text
		}
		return this.bbCodeMap[tag](fragment, name, text)
	}
	replaceBBCodeFunnyText(fragment, name, i, text){
		return this.makeFunnyText(name)
	}
	makeFunnyText(text){
		if(text.indexOf('&') != -1 && text.indexOf('&') != -1){
			const wrap = document.createElement('span')
			wrap.innerHTML = text
			text = wrap.innerText
		}
		if(!main.config['kids-fun-titles']){
			return text
		}
		const lettersPerColor = (text.length > 15 ? 3 : (text.length > 5 ? 2 : 1))
		const scales = [1, 0.9675, 0.925]
		const a = (this.funnyTextColors.length * lettersPerColor)
		return text.split('').map((chr, i) => {
			i--
			const scale = i < 2 ? 1 : scales[Math.floor(Math.random()*scales.length)]
			const oi = i
			const r = Math.floor(i / a)
			if(r){
				i -= r * a
			}
			const j = Math.floor(i / (lettersPerColor))
			if(chr == ' ') chr = '&nbsp;'
			return '<font class="funny-text" style="color: '+ (oi == -1 ? 'white' : this.funnyTextColors[j]) +';transform: scale('+ scale +');">'+chr+'</font>'
		}).join('')		
	}
}

class MenuModal extends MenuBBCode {
	constructor(container){
		super(container)
		this.inputHelper = new MenuURLInputHelper()
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
		const temp = document.createElement('div')
		temp.innerHTML = html
		return temp.textContent // Or return temp.innerText if you need to return only visible text. It's slower.
	}
	inModal(){
		return document.body.classList.contains('modal')
	}
	inModalMandatory(){
		return this.inModal() && document.body.classList.contains('modal-mandatory')
	}
	startModal(content, mandatory){
		this.sounds.play('warn', 80)
		this.emit('pre-modal-start')
		this.modalContent.innerHTML = content
		document.body.classList.add('modal')
		mandatory && document.body.classList.add('modal-mandatory')
		this.inputHelper.start()
		this.reset()
	}
	endModal(cancel){
		if(this.inModal()){
			if(this.debug){
				console.log('ENDMODAL')
			}
			this.inputHelper.stop()
			document.body.classList.remove('modal')
			document.body.classList.remove('modal-mandatory')
			this.emit('modal-end', cancel)
			setTimeout(() => this.emit('pos-modal-end'), 100)
		}
	}
	replaceTags(text, replaces) {
		if(replaces['name'] && !replaces['rawname']){
			replaces['rawname'] = replaces['name']
		}
		Object.keys(replaces).forEach(before => {
			let t = typeof(replaces[before])
			if(['string', 'number', 'boolean'].includes(t)) {
				let fixQuotes = (typeof(replaces.raw) == 'boolean' ? 
					!replaces.raw : (t == 'string' && replaces[before].indexOf('<') == -1))
				let to = fixQuotes ? this.fixQuotes(replaces[before]) : String(replaces[before])
				if(to.indexOf('[') != -1){
					if(before == 'rawname') {
						to = this.parseBBCode(to)
					}
				}
				text = text.split('{' + before + '}').join(to)
				if(text.indexOf("\r\n") != -1){
					text = text.replace(new RegExp('\r\n', 'g'), '<br />')
				}
			}
		})
		text = text.replace(new RegExp('\\{[a-z\\-]+\\}', 'g'), '')
		replaces.details && replaces.details.indexOf('<') != -1 && console.log('TEMPLATE', text)
		return text
	}  
	fixQuotes(text){
		return String(text || '').replace(new RegExp('"', 'g'), '&quot;')
	}
}

class MenuPlayer extends MenuModal {
	constructor(container){
		super(container)
	}
	inPlayer(){
		return typeof(streamer) != 'undefined' && streamer.active
	}
	isExploring(){
		return !this.inModal() && (!this.inPlayer() || document.body.classList.contains('menu-playing'))
	}
	showWhilePlaying(enable, ignoreFocus) {
		if (enable) {
			main.emit('menu-playing', true)
			document.body.classList.add('menu-playing')
			if (!ignoreFocus) {
				setTimeout(() => {
					this.restoreSelection() || this.reset()
				}, 100)
			}
		} else {
			main.emit('menu-playing', false)
			document.body.classList.remove('menu-playing')
			main.idle.reset()
			main.idle.lock(0.1)
		}
	}
}

class MenuFx extends MenuPlayer {
	constructor(container){
		super(container)
		this.fxNavTimer = 0
		this.fxModalTimer = 0
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
		this.on('pre-modal-start', () => {
			this.fxPromptIn()
		})
		setTimeout(() => {
			this.wrap.parentNode.classList.add('effect-inflate-deflate-parent')
			this.modalContent.parentNode.classList.add('effect-inflate-deflate-parent')
		})
	}
	fxNavIn(){
		if(!main.config['fx-nav-intensity']) return
		clearTimeout(this.fxNavTimer)
		if(this.wrap.classList.contains('effect-inflate')){
			this.wrap.classList.remove('effect-inflate')
			setTimeout(() => this.fxNavIn(), 0)
		} else {
			this.wrap.style.transition = 'none'
			this.wrap.classList.remove('effect-deflate')
			this.wrap.classList.add('effect-inflate')
			this.fxNavTimer = setTimeout(() => {
				this.wrap.classList.remove('effect-inflate')
			}, 1500)
		}
	}
	fxNavOut(){
		if(!main.config['fx-nav-intensity']) return
		clearTimeout(this.fxNavTimer)
		if(this.wrap.classList.contains('effect-deflate')){
			this.wrap.classList.remove('effect-deflate')
			setTimeout(() => {
				this.fxNavOut()
			}, 0)
		} else {
			this.wrap.style.transition = 'none'
			this.wrap.classList.remove('effect-inflate')
			this.wrap.classList.add('effect-deflate')
			this.fxNavTimer = setTimeout(() => {
				this.wrap.classList.remove('effect-deflate')
			}, 1500)
		}
	}
	fxPromptIn(){
		if(!main.config['fx-nav-intensity']) return
		clearTimeout(this.fxModalTimer)
		if(this.modalContent.classList.contains('effect-inflate')){
			this.modalContent.classList.remove('effect-inflate')
			setTimeout(() => this.fxPromptIn(), 0)
		} else {
			this.modalContent.style.transition = 'none'
			this.modalContent.classList.remove('effect-deflate')
			this.modalContent.classList.add('effect-inflate')
			this.fxModalTimer = setTimeout(() => {
				this.modalContent.classList.remove('effect-inflate')
			}, 1500)
		}
	}
}

class MenuDialogQueue extends MenuFx {
	constructor(container){
		super(container)
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

class MenuDialog extends MenuDialogQueue {
	constructor(container){
		super(container)
		this.lastSelectTriggerer = false
		this.modalTemplates['option'] = `
			<a href="javascript:;" class="modal-template-option" id="modal-template-option-{id}" title="{plainText}" aria-label="{plainText}">
				{aside}
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
				{aside}
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
				<input type="text" placeholder="{placeholder}" value="{text}" aria-label="{plainText}" onmousedown="main.menu.inputPaste(this)" />
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
	}
	inputPaste(input) {
		if(input.value || !top.navigator.clipboard) return
		top.navigator.clipboard.readText().then(paste => {
			if(paste) {
				paste = paste.trim()
				if(paste.startsWith('http') || paste.startsWith('//')) { // seems URL
					input.value = paste
					input.select()
				}
			}
		}).catch(console.error)
	}
	text2id(txt){
		if(txt.match(new RegExp('^[A-Za-z0-9\\-_]+$', 'g'))){
			return txt
		}
		return txt.toLowerCase().replace(new RegExp('[^a-z0-9]+', 'gi'), '')
	}
	dialog(entries, cb, defaultIndex, mandatory){
		this.queueDialog(() => {
			if(this.debug){
				console.log('DIALOG', entries, cb, defaultIndex, mandatory)
			}
			let html = '', opts = '', complete, callback = (k, cancel) => {
				if(complete) return
				if(this.debug){
					console.log('DIALOG CALLBACK', k, parseInt(k), cancel, complete)
				}
				// k = parseInt(k)
				complete = true
				if(k == -1){
					k = false
				}
				if(k == 'submit'){
					let el = this.modalContainer.querySelector('input, textarea')
					if(el){
						k = el.value
					}
				}
				if(cancel === true) return
				this.endModal()
				if(typeof(cb) == 'function'){
					cb(k)
				} else if(typeof(cb) == 'string'){
					cb = [cb, k]
					if(this.debug){
						console.warn('STRCB', cb)
					}
					main.emit(...cb)
				} else if(Array.isArray(cb)){
					cb.push(k)
					if(this.debug){
						console.warn('ARRCB', cb)
					}
					main.emit(...cb)
				}
			}
			let validatedDefaultIndex, optsCount = 0, optsHasInput, allowTwoColumnsOptionsGroup = true
			entries = entries.map(e => {
				if(typeof(e.oid) == 'undefined'){
					if(typeof(e.id) != 'undefined'){
						e.oid = e.id
						e.id = this.text2id(e.id)
					}
				}
				return e
			})
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
				if(e.isPassword){
					tpl = tpl.replace('type="text"', 'type="password"')
				}
				if(!e.text){
					e.text = e.plainText || ''
				}
				if(!e.plainText){
					e.plainText = this.plainText(e.text)
				}
				e.text = String(e.text).replaceAll('"', '&quot;')
				e.plainText = String(e.plainText).replaceAll('"', '')
				tpl = this.replaceTags(tpl, e)
				if(this.debug){
					console.log(tpl, e)
				}
				if(isOption){
					optsCount++
					if(!validatedDefaultIndex || (e.id && e.id == defaultIndex)){
						validatedDefaultIndex = e.id
					}
					if(e.template == 'text'){
						optsHasInput = true
					}
					if(allowTwoColumnsOptionsGroup){
						if(e.plainText.length > 50){
							allowTwoColumnsOptionsGroup = false
						}
					}
					opts += tpl
				} else {
					html += tpl
				}
			})
			if(opts){
				html += this.replaceTags(this.modalTemplates['options-group'], {opts})
			}
			console.log('MODALFOCUS', defaultIndex, validatedDefaultIndex, allowTwoColumnsOptionsGroup)
			this.startModal('<div class="modal-wrap"><div>' + html + '</div></div>', mandatory)
			let m = this.modalContent
			if(allowTwoColumnsOptionsGroup){
				let fitVal = 2, overVal	= 4
				if(optsHasInput){
					fitVal = 3, overVal	= 4
				}
				if(optsCount == fitVal || optsCount >= overVal){
					let grp = m.querySelector('.modal-template-options')
					if(grp){
						grp.className = grp.className +' two-columns'
					}
				}
			}
			entries.forEach(e => {
				if(['option', 'option-detailed'].includes(e.template)){
					let p = m.querySelector('#modal-template-option-' + e.id+', #modal-template-option-detailed-' + e.id)
					if(p){
						p.addEventListener('click', () => {
							let id = e.oid || e.id
							if(this.debug){
								console.log('OPTCLK', id, callback)
							}
							callback(id)
						})
						if(String(e.id) == String(validatedDefaultIndex)) {						
							this.delayedFocus(p, false)
						}
					}
				} else if(e.template == 'message') {						
					if(e.text.indexOf('<i ') != -1) {
						Array.from(m.querySelectorAll('.modal-template-message i')).forEach(s => {
							s.parentNode.style.display = 'block'
						})						
					}
				}
			})
			this.on('modal-end', cancel => {
				complete || callback(-1, cancel)
			})
			this.emit('dialog-start')
		})
	}
	info(title, text, cb, fa){
		this.queueDialog(() => {
			let complete, mpt = [
				{template: 'question', text: title, fa: fa || 'fas fa-info-circle'},
				{template: 'message', text},
				{template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
			];
			this.dialog(mpt, id => {
				if(!complete){
					if(this.debug){
						console.log('infocb', id, complete)
					}
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

class MenuSelect extends MenuDialog {
	constructor(container){
		super(container)
	}
	select(question, entries, fa, callback){
		let def, map = {}, opts = [
			{template: 'question', text: question, fa}
		]
		opts.push(...entries.map(e => {
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
		}))
		if(this.debug){
			console.warn('SELECT', entries)
		}
		this.dialog(opts, k => {
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

class MenuOpenFile extends MenuSelect {
	constructor(container){
		super(container)
		this.openFileDialogChooser = false
	}	
	async openFile(uploadURL, cbID, accepts){
		if(window.capacitor) {
			await window.capacitor.requestPermission('READ_EXTERNAL_STORAGE').catch(alert)
		}
		if(!this.openFileDialogChooser){ // JIT
			this.openFileDialogChooser = document.createElement('input')
			this.openFileDialogChooser.type = 'file'
			this.openFileDialogChooser.style.opacity = 0.05
			document.body.appendChild(this.openFileDialogChooser)
		}
		this.openFileDialogChooser.value = ''
		if(accepts){
			this.openFileDialogChooser.setAttribute('accept', accepts)
		} else {
			this.openFileDialogChooser.removeAttribute('accept')
		}
		this.openFileDialogChooser.currentListener && this.openFileDialogChooser.removeEventListener('change', this.openFileDialogChooser.currentListener)
		return new Promise((resolve, reject) => {
			this.openFileDialogChooser.currentListener = evt => {
				if(this.openFileDialogChooser.files.length && this.openFileDialogChooser.files[0].name){
					this.sendFile(uploadURL, this.openFileDialogChooser.files[0], this.openFileDialogChooser.value, cbID).then(resolve).catch(reject)
				} else {
					reject('Bad upload data')
				}
			}
			this.openFileDialogChooser.addEventListener('change', this.openFileDialogChooser.currentListener)
			this.openFileDialogChooser.click()
		})
	}
	sendFile(uploadURL, fileData, path, cbID) {
		return new Promise((resolve, reject) => {
			window.filesent = fileData;
			const xhr = new XMLHttpRequest()
			const formData = new FormData()	
			if (cbID) {
				formData.append('cbid', cbID)
			}
			formData.append('file', fileData)	
			xhr.open('POST', uploadURL, true)
			xhr.onreadystatechange = () => {
				if (xhr.readyState === 4) {
					if (xhr.status === 200) {
						resolve(xhr.responseText)
					} else {
						reject(xhr.statusText)
					}
				}
			}
			xhr.onerror = err => reject(err)
			xhr.send(formData)
		});
	}
}

class MenuPrompt extends MenuOpenFile {
	constructor(container){
		super(container)
		this.promptMemory = {}
	}
	prompt(atts){
		if(this.debug){
			console.log('PROMPT', atts)
		}
		let p, opts = [
			{template: 'question', text: atts.question, fa: atts.fa}
		]
		if(atts.message){
			opts.splice(1, 0, {template: 'message', text: atts.message})
		}
		const memId = atts.question || atts.placeholder
		console.warn("MEMID", memId, atts)
		opts.push({
			template: atts.multiline ? 'textarea' : 'text',
			text: this.promptMemory[memId] || atts.defaultValue || '',
			id: 'text',
			isPassword: atts.isPassword,
			placeholder: atts.placeholder
		})
		if(Array.isArray(atts.extraOpts) && atts.extraOpts.length){
			opts.push(...atts.extraOpts)
		} else {
			opts.push({template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'})
		}
		this.dialog(opts, id => {
			let ret = true
			if(this.debug){
				console.log('PROMPT CALLBACK', id, atts.callback, typeof(atts.callback))
			}
			if(typeof(id) == 'string' && id) {
				this.promptMemory[memId] = id
			}
			if(typeof(atts.callback) == 'function'){
				ret = atts.callback(id)
			} else if(typeof(atts.callback) == 'string'){
				atts.callback = [atts.callback, id]
				if(this.debug){
					console.warn('STRCB', atts.callback)
				}
				main.emit(...atts.callback)
			} else if(Array.isArray(atts.callback)){
				atts.callback.push(id)
				if(this.debug){
					console.warn('ARRCB', atts.callback)
				}
				main.emit(...atts.callback)
			}
			if(ret !== false){
				this.endModal()
				this.emit('prompt-end', id)
			}
		}, 'submit')
		this.inputHelper.stop()

		this.emit('prompt-start')

		p = this.modalContent.querySelector('#modal-template-option-submit')
		if(p){
			p.addEventListener('keypress', (event) => {
				if(this.debug){
					console.log(event.keyCode)
				}
				if (event.keyCode != 13) {
					main.hotkeys.arrowUpPressed()
				}
			})
		}
		main.hotkeys.arrowUpPressed()
		setTimeout(() => {
			this.inputHelper.start()
		}, 200)
	}
}

class MenuSlider extends MenuPrompt {
	constructor(container){
		super(container)
	}
	sliderSetValue(element, value, range, mask){
		const n = element.querySelector('.modal-template-slider-track')
		if(this.debug){
			console.warn('BROOW', n.value, value)
		}
		n.value = value
		this.sliderSync(element, range, mask)
	}
	sliderVal(element, range){
		const n = element.querySelector('.modal-template-slider-track'), value = parseInt(n.value)
		return value
	}
	sliderSync(element, range, mask){
		var l, h, n = element.querySelector('.modal-template-slider-track'), t = (range.end - range.start), step = 1, value = parseInt(n.value)
		// console.warn('SLIDERSYNC', {element, range, mask, step, value, val: this.sliderVal(element, range)})
		if(value < range.start){
			value = range.start
		} else if(value > range.end){
			value = range.end
		}
		if(this.debug){
			console.warn('SLIDER VALUE A', element, element.querySelector('.modal-template-slider-track').value, n.value)
		}
		var message
		if(mask == 'time'){
			message = main.clock.humanize(value, true)
		} else if(mask) {
			message = mask.replace(new RegExp('\\{0\\}'), value || '0')
		} else {
			message = value || '0'
		}
		h = element.parentNode.parentNode.querySelector('.modal-template-question')		
		h.innerHTML = h.innerHTML.split(': ')[0] + ': '+ message
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
	slider(question, message, range, value, mask, callback, fa){
		let s, n, e, step = 1
		let opts = [
			{template: 'question', text: question, fa}
		]
		if(message && message != question) {
			opts.push({template: 'message', text: message})
		}
		opts.push({template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'submit'})
		this.dialog(opts, ret => {
			if(ret !== false){
				ret = this.sliderVal(e, range)
				if(callback(ret) !== false){
					this.endModal()
					this.emit('slider-end', ret, e)
				}
			}
		}, '')

		s = this.modalContent.querySelector('#modal-template-option-submit')
		s.parentElement.insertBefore(this.buildElementFromHTML(this.modalTemplates['slider']), s)
		s.addEventListener('keydown', event => {
			switch(event.keyCode) {
				case 13:  // enter
					s.submit && s.submit()
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
		n.addEventListener('input', () => this.sliderSync(e, range, mask))
		n.addEventListener('change', () => this.sliderSync(e, range, mask))
		n.parentNode.addEventListener('keydown', event => {
			console.log('SLIDERINPUT', event, s)
			switch(event.keyCode) {
				case 13:  // enter
					s.click()
					break
			}
		})
		// console.log('SLIDER SETUP VALUE', {e, value, range, mask})
		this.sliderSetValue(e, value, range, mask)
		this.modalContent.querySelector('.modal-template-slider-left').addEventListener('click', event => {
			value = this.sliderIncreaseLeft(e, value, range, mask, step)
		})
		this.modalContent.querySelector('.modal-template-slider-right').addEventListener('click', event => {
			value = this.sliderIncreaseRight(e, value, range, mask, step)
		})
	}
}

class MenuStatusFlags extends MenuSlider {
	constructor(container){
		super(container)
		this.statusFlags = {}
		this.on('render', this.processStatusFlags.bind(this))
		main.on('stream-state-set', (url, flag) => {
			if(this.debug){
				console.warn('SETFLAGEVT', url, flag)
			}
			flag && this.setStatusFlag(url, flag, false)
		})
		main.on('stream-state-sync', data => {
			if(this.debug){
				console.warn('SYNCSTATUSFLAGS', data)
			}
			Object.keys(data).forEach(url => {
				data[url] && this.setStatusFlag(url, data[url], true)
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
	statusAddHTML(e) {
		if(e.url && typeof(this.statusFlags[e.url]) != 'undefined'){
			let status = this.statusFlags[e.url], type = e.type || 'stream', cls = e.class || ''
			if(status && cls.indexOf('skip-testing') == -1 && (type == 'stream' || cls.match(new RegExp('(allow-stream-state|entry-meta-stream)')))){
				let content = '', cls = ''
				if(status == 'tune'){
					content = '<i class="fas fa-layer-group"></i>'
				} else if(status == 'folder') {
					content = '<i class="fas fa-box-open"></i>'
				} else if(status == 'waiting') {
					content = '<i class="fas fa-clock"></i>'
				} else {
					let watched
					if(status.endsWith(',watched')) {
						watched = true
						status = status.substr(0, status.length - 8)
					}
					let txt = '', icon = watched ? 'fas fa-check' : ''
					if(status == 'offline') {
						if(!watched) icon = 'fas fa-times'
						cls = 'entry-status-flag entry-status-flag-failure'
					} else {
						if(!watched) icon = 'fas fa-play'
						cls = 'entry-status-flag entry-status-flag-success'
						if(main.config['status-flags-type']) txt = ' '+ status
					}
					content = '<i class="'+ icon +'" aria-hidden="true"></i>'+ txt
					if(main.config['status-flags-type']) content = '&nbsp;'+ content +'&nbsp;'
				}
				e.statusFlagsClass = cls
				e.statusFlags = content
				const offline = status == 'offline'
				if(offline) {
					if(!e.class || e.class.indexOf('entry-disabled') == -1) {
						e.class = (e.class || '') +' entry-disabled'
					}
				} else if(e.class && e.class.indexOf('entry-disabled') != -1) {
					e.class = e.class.replace(new RegExp('( |^)entry-disabled', 'g'), '')
				}
			}
		}
		return e
	}
	processStatusFlags(){
		this.currentEntries.map(e => this.statusAddHTML(e))
		this.uiUpdate(false)
	}
}

class MenuLoading extends MenuStatusFlags {
	constructor(container){
		super(container)
		this.originalNames = {}
		main.on('set-loading', (data, active) => {
			if(!data) return
			console.log('set-loading', data, active)
			this.get(data).forEach(e => {
				this.setLoading(e, active)
			})
		})
		main.on('unset-loading', () => {
			this.unsetLoading()
		})
		main.on('render', (_, path) => {
			if(path != this.path) this.unsetLoading()
		})
		main.on('display-error', () => {
			this.unsetLoading()
		})
	}
	setLoading(element, active){
		console.log('setLoading', element, active)
		if(!element) return
		if(active){
			if(!element.classList.contains('entry-loading')){
				element.classList.add('entry-loading')
			}
		} else {
			if(element.classList.contains('entry-loading')){
				element.classList.remove('entry-loading')
			}
		}
	}
	unsetLoading(){ // remove any loading state entry
		Array.from(document.body.querySelectorAll('a.entry-loading')).forEach((e, i) => {
			this.setLoading(e, false)
		})
	}
}

class MenuNav extends MenuLoading {
	constructor(container){
		super(container)
		this.sideMenuWidthCache = null
		this.sideMenuSyncTimer = 0
		setTimeout(() => this.sideMenu(false, 'instant'), 0)
	}
	inSideMenu() {
		const w = this.getSideMenuWidth()
		return this.container.scrollLeft <= (w / 2)
	}
	sideMenuSync(resized, inSideMenu) {
		if(resized === true) {
			this.sideMenuWidthCache = null
		}
		const c = typeof(inSideMenu) == 'boolean' ? inSideMenu : this.inSideMenu() // if should add class 'side-menu'
		const n = document.body.classList.contains('side-menu')
		if(c != n) {
			document.body.classList[c ? 'add' : 'remove']('side-menu')
		}
		this.selected(true) // update current selection
	}
	sideMenu(enable, behavior='smooth') {
		if(this.inSideMenu() !== enable) {
			enable && this.saveSelection()
			this.container.scroll({
				top: 0,
				left: enable ? 0 : this.getSideMenuWidth(),
				behavior
			})
		}
		this.sideMenuSync(false, enable)
	}
	getSideMenuWidth() {
		if(this.sideMenuWidthCache && this.sideMenuWidthCache.size) {
			return this.sideMenuWidthCache.size
		}
		let size
		const l = document.createElement('div')
		l.style.visibility = 'hidden'
		l.style.boxSize = 'content-box' 
		l.style.position = 'absolute'
		l.style.maxHeight = 'none'
		l.style.height = 'var(--nav-width)'
		document.body.appendChild(l)
		size = l.clientHeight
		document.body.removeChild(l)
		this.sideMenuWidthCache = {size}
		return size
	}
}

export class Menu extends MenuNav {
	constructor(container){
		console.log('menu init')
		try {
			super(container)
		} catch(e) {
			console.error(e)
		}
		console.log('menu init')
		main.on('menu-playing', () => {			
			if(!document.body.classList.contains('menu-playing')){
				document.body.classList.add('menu-playing')
				main.emit('menu-playing', true)
				setTimeout(() => this.reset(), 100)
			}
		})
		main.on('menu-playing-close', () => {			
			if(document.body.classList.contains('menu-playing')){
				document.body.classList.remove('menu-playing')
				main.emit('menu-playing', false)
			}
		})
		main.on('render', (entries, path, icon) => {
			this.render(entries, path, icon)
		})
		main.on('menu-select', (entries, path, icon) => {
			this.setupSelect(entries, path, icon)
		})
		main.on('info', (a, b, c) => {
			this.info(a, b, null, c)
		})
		main.on('dialog', (a, b, c, d) => {
			this.dialog(a, b, c, d)
		})
		main.on('dialog-close', cancel => {
			this.endModal(cancel)
		})
		main.on('prompt', atts => this.prompt(atts))
		this.initialized = false
		this.currentEntries = []
		this.currentElements = []
		this.range = {start: 0, end: 99}
		this.lastOpenedElement = null // prevent multi-click
		this.lastOpenedElementTime = null; // prevent multi-click
		this.ranging = false
		main.on('trigger', data => {
			if(this.debug){
				console.warn('TRIGGER', data)
			}
			this.get(data).forEach(e => {
				e.click()
			})
		})
		console.log('menu init')
		                  
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
		['name', 'details', 'fa', 'type', 'prepend', 'class'].some(p => { // url comparing give false positives like undefined != javascript:;
			if(a[p] != b[p]){
				diff = p
				return true
			}
		})
		return diff
	}
	render(entries, path, icon){
		this.rendering = true
		this.resetScrollEmittingTimer()
		let prevEntries = [], navigated = path == this.path
		if(navigated) {
			prevEntries = this.currentEntries
		}
		entries = entries.map(e => this.prepareEntry(e))
		let changed = this.applyCurrentEntries(entries)
		this.emit('pre-render', path, this.path)
		this.path = path
		this.lastOpenedElement = null
		changed && this.uiUpdate(changed)
		prevEntries = null
		setTimeout(() => {
			this.currentElements = Array.from(this.wrap.getElementsByTagName('a'))
			this.has2xEntry = this.currentElements.slice(0, 2).some(e => e.classList.contains('entry-2x'))
			this.restoreSelection() // keep it in this timer, or the hell gates will open up!
			this.rendering = false
			this.emit('render', this.path, icon)
			if(!this.initialized){
				this.initialized = true
				this.emit('init')
			}
		}, 0)
	}
	uiUpdate(pageChanged){
		this.resetScrollEmittingTimer()
		let targetScrollTop = 0, path = this.path
		if(!pageChanged){
			targetScrollTop = this.wrap.scrollTop
		} else if(typeof(this.selectionMemory[path]) != 'undefined' && this.selectionMemory[path].default) {
			targetScrollTop = this.selectionMemory[path].default.scroll
		}
		this.wrap.style.minHeight = (targetScrollTop + this.wrap.offsetHeight) + 'px' // avoid scrolling
		this.emit('updated')
		setTimeout(() => {
			this.wrap.style.minHeight = 0
			this.scrollTop(targetScrollTop, true)
			this.getRange(targetScrollTop)
		}, 0)
	}
	applyCurrentEntries(entries) {
		let changed
		if(this.currentEntries.length > entries.length) {
			changed = true
			this.currentEntries.splice(entries.length, this.currentEntries.length - entries.length)
		}
		entries.forEach((e, i) => {
			if(this.currentEntries[i]) {
				const ek = Object.keys(e), ck = Object.keys(this.currentEntries[i])	
				const excludes = ck.filter(k => !ek.includes(k))
				for(const k of excludes) {
					changed = true
					delete this.currentEntries[i][k]
				}
				for(const k of ek) {
					if(!this.currentEntries[i].hasOwnProperty(k) || this.currentEntries[i][k] !== entries[i][k]) {
						changed = true
						this.currentEntries[i][k] = entries[i][k]
					}
				}
			} else {
				changed = true
				this.currentEntries[i] = entries[i]
			}
		})
		return changed
	}
	viewportRange(scrollTop, entriesCount){
		let limit = (this.gridLayoutX * this.gridLayoutY)
		if(this.currentElements.length){ // without elements (not initialized), we can't calc the element height
			if(typeof(scrollTop) != 'number'){
				scrollTop = this.wrap.scrollTop
			}
			if(typeof(entriesCount) != 'number'){
				entriesCount = this.currentElements.length
			}
			let entryHeight = this.currentElements[0].offsetHeight
			let i = Math.round(scrollTop / entryHeight) * this.gridLayoutX
			if(this.has2xEntry) {
				if(i) {
					i--
				} else {
					limit--
				}				
			}
			let end = Math.min(i + limit, entriesCount - 1)
			return {start: i, end}
		} else {
			return {start: 0, end: limit}
		}
	}
	viewportEntries(){
		let ret = [], as = this.currentElements
		if(as.length){
			let range = this.viewportRange()
			ret = as.slice(range.start, range.end)
		}
		return ret
	}
    getRange(targetScrollTop){
		if(typeof(targetScrollTop) != 'number'){
			targetScrollTop = this.wrap.scrollTop
		}
		this.ranging = false
		let entries = [], tolerance = this.gridLayoutX, vs = Math.ceil(this.gridLayoutX * this.gridLayoutY), minLengthForRanging = vs + (tolerance * 2), shouldRange = main.config['show-logos'] && this.currentEntries.length >= minLengthForRanging
		this.range = this.viewportRange(targetScrollTop, this.currentEntries.length)
		if(shouldRange){
			let trange = Object.assign({}, this.range)
			trange.end += tolerance
			if(trange.start >= tolerance){
				trange.start -= tolerance
			}
			this.currentEntries.forEach((e, i) => {
				const lazy = i < trange.start || i > trange.end
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
			const changed = [], shouldUpdateRange = main.config['show-logos'] && this.currentEntries.length > (this.gridLayoutX * this.gridLayoutY)
			if(shouldUpdateRange){
				const rgx = new RegExp('<img', 'i'), elements = this.currentElements
				const currentScrolltop = this.wrap.scrollTop, entries = this.getRange(y)
				//console.log('selectionMemory upadeteRange', entries)
				if(this.debug){
					console.warn("UPDATING RANGE", y, currentScrolltop, entries)
				}
				entries.forEach((e, i) => {
					if(!elements[e.tabindex]) return
					if(this.debug){
						//console.warn(e.type, type, elements[e.tabindex], e.tabindex, this.selectedIndex)
					}
					const lazy = e.lazy && elements[e.tabindex].innerHTML.match(rgx)
					if(lazy != elements[e.tabindex].getAttribute('data-lazy')){
						elements[e.tabindex].setAttribute('data-lazy', !!lazy)
						changed.push(elements[e.tabindex])
					} else {
						elements[e.tabindex].setAttribute('data-lazy', false)
					}
				})
				this.wrap.scrollTop = currentScrolltop // scroll was somehow being changed from function start to this point
				main.emit('menu-update-range', this.range, this.path)
				if(changed.length){
					console.log('updateRange', changed, this.range, this.selectedIndex)
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
		this.sounds.play('switch', 65)
		const i = element.tabIndex
		const value = !element.querySelector('.fa-toggle-on')
		const path = element.dataset.path
		this.currentEntries[i].fa = 'fas fa-toggle-'+  (value ? 'on' : 'off')
		this.currentEntries[i].value = value
		if(this.debug){
			console.warn('NAVCHK', path, value)
		}
		main.emit('menu-check', path, value)
		this.uiUpdate(false)
	}
	setupSelect(entries, path, fa){
		const element = this.wrap.querySelector('[data-path="'+ path.replaceAll('"', '&quot;') +'"]')
		if(element && element.length){
			const icon = element.querySelector('img')
			if(icon && icon.length){
				icon = window.getComputedStyle(icon).getPropertyValue('background-image')
				if(icon){
					icon = icon.match(new RegExp('url\\([\'"]*([^\\)\'"]*)', 'i'))
					if(icon){
						fa = icon[1]
					}
				}
			}
		}
		if(!Array.isArray(entries)) return
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
				main.emit('menu-open', actionPath)
				if(element){
					element.setAttribute('data-default-value', retPath)
				}
			}
			this.delayedFocus(this.lastSelectTriggerer, true)
		})
	}
	setupSlider(element){
		const path = element.getAttribute('data-path')
		const start = parseInt(element.getAttribute('data-range-start') || 0)
		const end = parseInt(element.getAttribute('data-range-end') || 100)
		const mask = element.getAttribute('data-mask')
		const def = this.currentEntries[element.tabIndex].value || ''
		const fa = element.getAttribute('data-original-icon') || ''
		const question = element.getAttribute('data-question') || element.getAttribute('title')
		const message = element.getAttribute('data-dialog-details')
		this.slider(question, message, {start, end}, parseInt(def || 0), mask, value => {
			const i = element.tabIndex
			if(value !== false){
				if(this.debug){
					console.warn('NAVINPUT', path, value)
				}
				main.emit('menu-input', path, value)
				if(this.currentEntries[i]) {
					this.currentEntries[i].value = value
					this.prepareEntry(this.currentEntries[i], i)
				}				
				this.uiUpdate(false)
			}
			setTimeout(() => {
				console.warn('DELAYED FOCUS ON', i, this.currentElements[i])
				this.focus(this.currentElements[i], true)
			}, 200)
		}, fa)
	}
	open(element){
		this.focus(element, true)
		let timeToLock = 3, path = element.getAttribute('data-path'), type = element.getAttribute('data-type'), tabindex = element.tabIndex || 0
		if(this.lastOpenedElement == element && ['back', 'stream', 'group'].includes(type) && ((this.lastOpenedElementTime + timeToLock) > time())){
			if(this.debug){
				console.log('multi-click prevented')
			}
			return
		}
		this.lastOpenedElement = element
		this.lastOpenedElementTime = time()
		element.addEventListener('blur', () => {
			this.lastOpenedElement = null
		}, {once: true})
		switch(type){
			case 'back':
				this.sounds.play('click-out', 50)
				break
			case 'group':
				this.sounds.play('click-in', 65)
				break
			case 'stream':
				this.sounds.play('warn', 80)
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
			this.setLoading(element, true)
		} else if(type == 'group'){
			this.setLoading(element, true)
		}
		if(this.debug){
			console.warn('menu-open', path, type, tabindex || false)
		}
		this.emit('open', type, path, element, tabindex || false)
		if(type == 'action' || type == 'input'){
			main.emit('menu-action', path, tabindex || false)
		} else if(type == 'back'){
			main.emit('menu-back')
		} else if(type == 'select'){
			this.lastSelectTriggerer = element
			main.emit('menu-select', path, tabindex || false)
		} else {
			main.emit('menu-open', path, tabindex || false)
		}
	}
	action(element){
		let type = element.getAttribute('data-type')
		console.log('action', type, element)
		switch(type){
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
			main.emit('menu-open', path)
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
		if(e.type != 'back') {
			if(this.icons[e.path] && this.icons[e.path].url.startsWith('fa')){
				e.fa = this.icons[e.path].url
			}
			if(!e.fa){
				if(!e.icon || !e.icon.startsWith('fa')) {
					if(this.defaultIcons[e.type]){
						e.fa = 'fas ' + this.defaultIcons[e.type]
					}
				} else {
					e.fa = e.icon
				}
			}
			if(e.fa && !this.icons[e.path]) {
				this.icons[e.path] = {url: e.fa}
			}
		}
		if(!e.path){
			e.path = this.path
			if(e.path){
				e.path +=  '/'
			}
			e.path += e.name
		}
		if(e.type == 'check') {
			e.fa = 'fas fa-toggle-'+ (e.value ? 'on' : 'off')
		}
		if(typeof(e.statusFlags) != 'string') e.statusFlags = ''
		e.maskText = ''
		if(e.mask && typeof(e.value) != 'undefined') {
			if(e.mask === 'time') {
				e.maskText = main.clock.humanize(e.value, true)
			} else if(typeof(e.value) != 'boolean') {
				e.maskText = e.mask.replace('{0}', e.value)
			}
		}
		if(e.rawname && e.rawname.indexOf('[') != -1) {
			e.rawname = this.parseBBCode(e.rawname)
		}
		e.wrapperClass = 'entry-wrapper'
		if(!e.side &&  this.icons[e.path] && this.icons[e.path].cover && (main.config['stretch-logos'] || (e.class && e.class.indexOf('entry-force-cover') != -1))) {
			e.cover = true
			e.wrapperClass += ' entry-cover-active'
		} else {
			if(e.cover) {
				e.cover = false
			}
			if(e.wrapperClass.indexOf('entry-cover-active') != -1) {
				e.wrapperClass = e.wrapperClass.replace(new RegExp(' *entry\-cover\-active *', 'g'), ' ')
			}
		}
		if(typeof(e.prepend) != 'string') {
			e.prepend = ''
		}
		e.key = ((e.path && e.path != ' ') ? e.path : String(Math.random())) + (e.url || '') // svelte id, added url to key to fix stream-state processing
		return e
	}
}