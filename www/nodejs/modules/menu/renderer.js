import { ESMitter as EventEmitter } from 'esm-itter'
import { Sounds } from './sound'
import { main } from '../bridge/renderer'

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
                if(v.length == 6 && !v.includes(':')){
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
		this.sounds = new Sounds()
		this.debug = false
		this.path = ''
		this.container = container
		this.wrap = container.querySelector('svelte-virtual-grid-contents')
		this.scrollContainer = this.wrap.parentNode
		container.addEventListener('click', event => {
			event.preventDefault()
			const a = event.target.closest('a')
			if(a && !a.classList.contains('entry-ignore')) {
				if(this.inSideMenu()) {
					this.sideMenuPending = true
				}
				this.action(a)
			}
		})
		main.on('config', (_, c) => this.sounds.volume = c.volume)
		if (main.config && main.config['volume'] !== undefined) {
			this.sounds.volume = main.config['volume']
		}
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
			
			if(!data.force) {
				if(this.icons[fullPath].cover === false && isCover) { // prefer alpha icons
					return
				}
				if(this.icons[fullPath].cover === isCover) { // ignore updates with same type
					return
				}
			}

			if(this.icons[fullPath].cover != isCover) {
				this.icons[fullPath].cover = isCover
				changed = true
			}
			if(this.icons[fullPath].url != data.url) {
				this.icons[fullPath].url = data.url
				changed = true
			}
			
			if(changed) {
				this.emit('updated')
			}
		})
	}
}

class MenuScrolling extends MenuIcons {
    constructor(container){
        super(container)
		this.layouts = []
		this.defaultNavGroup = ''
        this.angleWeight = 0.2
        this.className = 'selected'
        this.parentClassName = 'selected-parent'
        this.selectedIndex = 0
		const scrollEndTrigger = () => {
			if(this.isScrolling) {
				this.isScrolling = false
				this.scrollContainer.style.scrollSnapType = 'y mandatory'
			}
			if(this.lastScrollTop !== this.scrollContainer.scrollTop){
				this.lastScrollTop = this.scrollContainer.scrollTop				
				this.emit('scroll', this.scrollContainer.scrollTop)
			}
		}
		this.scrollendPolyfillElement(this.container)
		this.scrollendPolyfillElement(this.scrollContainer)
		for(const type of ['scrollend', 'resize']) {
			// scroll was not always emitting on mobiles, scrollend is too new and not supported by all browsers
			this.scrollContainer.addEventListener(type, scrollEndTrigger, {capture: true, passive: true})
		}
        this.scrollContainer.addEventListener('touchstart', () => {
			this.scrollContainer.style.scrollSnapType = 'none'
		})
		this.scrollContainer.addEventListener('touchend', () => {
			this.scrollContainer.style.scrollSnapType = 'y mandatory'
		})
		this.scrollContainer.addEventListener('scroll', () => {
			if(!this.isScrolling) {
				this.isScrolling = true
				this.scrollContainer.style.scrollSnapType = 'none'
			}
		})

		const resizeListener = () => this.resize()
		window.addEventListener('resize', resizeListener, { capture: true })
		window.addEventListener('orientationchange', resizeListener, { capture: true })
		screen.orientation && screen.orientation.addEventListener('change', resizeListener)
		setTimeout(resizeListener, 0)
		
		this.scrollContainer.addEventListener('touchstart', event => {
			console.log('touchstart', event.target.tagName)
			const t = event.target.tagName?.toLowerCase()
			const e = t === 'a' ? event.target : event.target.closest('a')
			if(!e) return
			let timeout
			const start = () => {
				console.log('start')
				timeout = setTimeout(() => {
					console.log('hold')
					const holdEvent = new CustomEvent('hold', {bubbles: false})
					e.dispatchEvent(holdEvent)
					this.emit('focus', e)
				}, 500)
			}
			const cancel = () => {
				console.log('cancel')
				clearTimeout(timeout)
				document.removeEventListener('touchend', cancel)
				document.removeEventListener('touchmove', cancel)
			}
			start()
			document.addEventListener('touchend', cancel)
			document.addEventListener('touchmove', cancel)
		})
	}
    setGrid(x, y, px, py){
        this._gridLayoutX = x
        this._gridLayoutY = y
        this._gridLayoutPortraitX = px
        this._gridLayoutPortraitY = py
        this.resize()
    }
    resize(force){
		if(force !== true && this.lastSize && this.lastSize.x == window.innerWidth && this.lastSize.y == window.innerHeight) return
		this.lastSize = {x: window.innerWidth, y: window.innerHeight}
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
		this.sideMenuSync(true)
	}
	scrollTop(y, animate){
        if(typeof(y) == 'number' && this.scrollContainer.scrollTop != y) {
			this.scrollContainer.scroll({
				top: y,
				left: 0,
				behavior: animate ? 'smooth' : 'instant'
			})
		}
		return this.scrollContainer.scrollTop
	}
    opposite(selected, items, direction){
        let i, n = items.indexOf(selected), x = this.gridLayoutX, y = this.gridLayoutY
        switch(direction) {
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
	reset(force){
		this.emit('reset', force)
	}
}

class MenuBBCode extends MenuScrolling {
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
		if(text.includes('&') && text.includes(';')){
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
		this.emit('modal-start')
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
					!replaces.raw : (t == 'string' && !replaces[before].includes('<')))
				let to = fixQuotes ? this.fixQuotes(replaces[before]) : String(replaces[before])
				if(to.includes('[')){
					if(before == 'rawname') {
						to = this.parseBBCode(to)
					}
				}
				text = text.split('{' + before + '}').join(to)
				if(text.includes("\r\n")){
					text = text.replace(new RegExp('\r\n', 'g'), '<br />')
				}
			}
		})
		text = text.replace(new RegExp('\\{[a-z\\-]+\\}', 'g'), '')
		replaces.details && replaces.details.includes('<') && console.log('TEMPLATE', text)
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
	isVisible(element, ignoreViewport){
		if(element) {
			if (element.style.display === 'none' || element.style.visibility === 'hidden') {
				return false;
			}
			if (parseFloat(element.style.opacity) === 0) {
				return false;
			}
			let parent = element.parentElement;
			while (parent) {
				if (!parent) {
					return false;
				}
				if (window.getComputedStyle(parent).visibility === 'hidden') {
					return false;
				}
				if(parent === document.body) {
					break;
				}
				parent = parent.parentElement;
			}
			const rect = element.getBoundingClientRect();
			// when inViewport is true, more than 75% of the element should be visible in the viewport
			if (ignoreViewport !== true) {
				if (!element.parentElement) return false;

				const parentElement = element.parentElement?.tagName?.toLowerCase() == 'svelte-virtual-grid-contents' ? element.parentElement.parentNode : element.parentElement;
				if (!parentElement) return false;

				const parentRect = parentElement.getBoundingClientRect();

				const intersectionLeft = Math.max(rect.left, parentRect.left);
				const intersectionRight = Math.min(rect.right, parentRect.right);
				const intersectionTop = Math.max(rect.top, parentRect.top);
				const intersectionBottom = Math.min(rect.bottom, parentRect.bottom);

				if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) {
					return false;
				}

				const intersectionArea = (intersectionRight - intersectionLeft) * (intersectionBottom - intersectionTop);
				const elementArea = rect.width * rect.height;

				if (intersectionArea < 0.75 * elementArea) {
					return false;
				}
			}
			return element.offsetParent !== null
		}
		return !this.inModal() && (!this.inPlayer() || document.body.classList.contains('menu-playing'))
	}
	showWhilePlaying(enable) {
		if (enable) {
			if(!document.body.classList.contains('menu-playing')) {
				document.body.classList.add('menu-playing')
				this.emit('menu-playing', true)
			}
		} else {
			if(document.body.classList.contains('menu-playing')) {
				document.body.classList.remove('menu-playing')
				this.emit('menu-playing', false)
			}
		}
	}
}

class MenuFx extends MenuPlayer {
	constructor(container){
		super(container)
		this.fxNavTimer = 0
		this.fxModalTimer = 0
		this.on('before-navigate', (newPath, oldPath) => {
			if(typeof(oldPath) != 'string' || newPath.length >= oldPath.length){
				this.fxNavIn()
			} else {
				this.fxNavOut()
			}
		})
		this.on('pre-modal-start', () => {
			this.fxPromptIn()
		})
		setTimeout(() => {
			this.container.parentNode.classList.add('effect-inflate-deflate-parent')
			this.modalContent.parentNode.classList.add('effect-inflate-deflate-parent')
		})
	}
	fxNavIn(){
		if(!main.config['fx-nav-intensity']) return
		clearTimeout(this.fxNavTimer)
		if(this.container.classList.contains('effect-inflate')){
			this.container.classList.remove('effect-inflate')
			setTimeout(() => this.fxNavIn(), 0)
		} else {
			this.container.style.transition = 'none'
			this.container.classList.remove('effect-deflate')
			this.container.classList.add('effect-inflate')
			this.fxNavTimer = setTimeout(() => {
				this.container.classList.remove('effect-inflate')
			}, 1500)
		}
	}
	fxNavOut(){
		if(!main.config['fx-nav-intensity']) return
		clearTimeout(this.fxNavTimer)
		if(this.container.classList.contains('effect-deflate')){
			this.container.classList.remove('effect-deflate')
			setTimeout(() => {
				this.fxNavOut()
			}, 0)
		} else {
			this.container.style.transition = 'none'
			this.container.classList.remove('effect-inflate')
			this.container.classList.add('effect-deflate')
			this.fxNavTimer = setTimeout(() => {
				this.container.classList.remove('effect-deflate')
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
				<input type="text" placeholder="{placeholder}" data-default-value="{defaultValue}" data-mask="{mask}" value="{text}" aria-label="{plainText}" onfocus="main.menu.inputPaste(this)" />
			</span>
		`
		this.modalTemplates['textarea'] = `
			<span class="modal-template-textarea" id="modal-template-option-{id}">
				<span>
					<span>
						<i class="fas fa-caret-right"></i>
					</span>
				</span>
				<textarea placeholder="{placeholder}" data-default-value="{defaultValue}" rows="3" aria-label="{plainText}" onfocus="main.menu.inputPaste(this)">{text}</textarea>
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
	async inputPaste(input) {
		if(!input.value || input.value == input.getAttribute('data-default-value')) {
			let err
			const paste = await this.readClipboard().catch(e => err = e)
			if(err) {
				console.error(err)
			} else if(paste && String(input.getAttribute('data-pasted')) != paste) {
				input.setAttribute('data-pasted', paste)
				const mask = input.getAttribute('data-mask') || '(^.{0,6}//|[a-z]{3,6}?://)[^ ]+'
				const regex = new RegExp(mask, 'i')
				const matched = paste.match(regex)
				if(matched) {
					input.value = matched[0]
					input.select()
				}
			}
		}
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
					if(!e.fa.includes('//')){
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
							p.focus()
							p.scrollIntoViewIfNeeded({behavior: 'instant'})
						}
					}
				} else if(e.template == 'message') {						
					if(e.text.includes('<i ')) {
						m.querySelectorAll('.modal-template-message i').forEach(s => {
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
			mask: atts.mask,
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
			}
		}, 'submit')
		this.inputHelper.stop()
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
		const n = element.querySelector('.modal-template-slider-track')
		return parseInt(n.value)
	}
	sliderSync(element, range, mask){
		var l, h, n = element.querySelector('.modal-template-slider-track'), t = (range.end - range.start), step = 1, value = parseInt(n.value)
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
			if(e && ret !== false){
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
		this.on('changed', this.processStatusFlags.bind(this))
		main.on('stream-state-set', (url, flag) => {
			if(this.debug){
				console.warn('SETFLAGEVT', url, flag)
			}
			flag && this.setStatusFlag(url, flag, false)
		})
		main.on('stream-state-sync', data => {
			if(this.debug){
				console.warn('SYNCSTATUSFLAGS', data, this.scrollContainer.scrollTop)
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
			if(status && !cls.includes('skip-testing') && (type == 'stream' || cls.match(new RegExp('(allow-stream-state|entry-meta-stream)')))){
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
					if(!e.class || !e.class.includes('entry-disabled')) {
						e.class = (e.class || '') +' entry-disabled'
					}
				} else if(e.class && e.class.includes('entry-disabled')) {
					e.class = e.class.replace(new RegExp('( |^)entry-disabled', 'g'), '')
				}
			}
		}
		return e
	}
	processStatusFlags(){
		this.currentEntries.map(e => this.statusAddHTML(e))
		this.emit('updated')
	}
}

class MenuNav extends MenuStatusFlags {
	constructor(container){
		super(container)
		this.sideMenuWidthCache = null
		this.sideMenuSyncTimer = 0
		setTimeout(() => this.sideMenu(false, 'instant'), 0)
		this.scrollendPolyfillElement(this.container)
		this.container.addEventListener('scrollend', () => this.sideMenuSync())
	}
	scrollendPolyfillElement(element) {
		if('onscrollend' in window) return
		let isScrolling
		const dispatchScrollEndEvent = () => {
			const event = new CustomEvent('scrollend')
			element.dispatchEvent(event)
		}
		element.addEventListener('scroll', () => {
			window.clearTimeout(isScrolling)
			isScrolling = setTimeout(dispatchScrollEndEvent, 150)
		}, false)
	}
	inSideMenu(strict=false) {
		const w = this.getSideMenuWidth()
		return strict ? this.container.scrollLeft < 10 : (this.container.scrollLeft <= (w / 2))
	}
	sideMenuSync(resized, inSideMenu) {
		if(resized === true) {
			this.sideMenuWidthCache = null
		}
		const c = typeof(inSideMenu) == 'boolean' ? inSideMenu : this.inSideMenu() // if should add class 'side-menu'
		const n = document.body.classList.contains('side-menu')
		if(c != n) {
			document.body.classList[c ? 'add' : 'remove']('side-menu')
			this.emit('side-menu', c)
		}
	}
	sideMenuTransition() {
		if (!this.sideMenuTransitionCache) {
			this.sideMenuTransitionCache = window.getComputedStyle(this.container).getPropertyValue('transition') || 
				'transform var(--menu-fx-nav-duration) ease-in-out 0s'
		}
		return this.sideMenuTransitionCache
	}
	sideMenu(enable, behavior='smooth') {
		const transition = this.sideMenuTransition()
		const left = enable ? 0 : this.getSideMenuWidth()
		console.warn('sideMenu', {left, scrollLeft: Math.round(this.container.scrollLeft), transition: this.sideMenuTransitioning})
		if (left == Math.round(this.container.scrollLeft)) {
			this.sideMenuTransitioning = false
			return
		}
		if (left === this.sideMenuTransitioning) { // strict comparison
			return
		}
		this.sideMenuTransitioning = left
		this.container.style.transition = behavior == 'smooth' ? transition : 'none'
		this.container.addEventListener('scrollend', () => {
			this.container.style.transition = transition
			this.sideMenuTransitioning = false
		}, {once: true})
		this.container.scroll({
			top: 0,
			left,
			behavior
		})
	}
	getSideMenuWidth() {
		if(this.sideMenuWidthCache) {
			return this.sideMenuWidthCache
		}
		const l = document.createElement('div')
		l.style.visibility = 'hidden'
		l.style.boxSize = 'content-box' 
		l.style.position = 'absolute'
		l.style.maxHeight = 'none'
		l.style.display = 'inline-block'
		l.style.height = 'var(--nav-width)'
		document.body.appendChild(l)
		this.sideMenuWidthCache = Math.round(l.clientHeight)
		document.body.removeChild(l)
		return this.sideMenuWidthCache
	}
}

export class Menu extends MenuNav {
	constructor(container){
		try {
			super(container)
		} catch(e) {
			console.error(e)
		}
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
		this.currentEntries = []
		main.on('trigger', data => {
			if(this.debug){
				console.warn('TRIGGER', data)
			}
			this.get(data).forEach(e => {
				e.click()
			})
		})
		main.on('menu-busy', state => {
			this.busy = state !== false
			document.querySelector('.menu-busy').style.display = this.busy ? 'flex' : 'none'
			document.querySelector('.menu-time time').style.display = this.busy ? 'none' : 'flex'
			if(state) {
				for(const path of state) {
					this.get({path}).forEach(e => {
						e?.classList.add('entry-busy')
					})
				}
			} else {
				this.wrap.querySelectorAll('.entry-busy').forEach(e => e.classList.remove('entry-busy'))
			}
		})
	}
	get(data){
		let ss = []
		if(data){
			let ks = Object.keys(data)
			if(ks.length){
				this.currentEntries.forEach((e, i) => {
					if(ks.every(k => data[k] == e[k])){
						const element = this.wrap.querySelector(`[tabindex="${e.tabindex}"]`)
						console.log('get', data, e, element)
						ss.push(element)
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
		let prevPath = this.path, navigated = path !== this.path
		entries = entries.map(e => this.prepareEntry(e))
		let changed = this.applyCurrentEntries(entries)
		navigated && this.emit('before-navigate', path, this.path)
		this.path = path
		if (!changed) return
		this.emit('changed')
		this.emit('render', this.path, icon, prevPath)
		navigated && this.emit('navigate', path, this.path)
	}
	applyCurrentEntries(entries) {
		let changed = this.currentEntries.length != entries.length
		if(!changed) {
			changed = entries.some((e, i) => {
				for(const k of Object.keys(e)) {
					if(this.currentEntries[i][k] !== e[k]) {
						return true
					}
				}
			})
		}
		if(changed) {
			this.currentEntries = entries
		}
		return changed
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
		this.emit('updated')
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
			this.lastSelectTriggerer && setTimeout(() => {
				this.emit('focus', this.lastSelectTriggerer)
				this.lastSelectTriggerer = null
			}, 50)
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
				this.emit('updated')
			}
			setTimeout(() => {
				console.warn('DELAYED FOCUS ON', i, this.currentEntries[i])
				this.emit('focus-index', i)
			}, 50)
		}, fa)
	}
	open(element){
		let timeToLock = 3, path = element.getAttribute('data-path'), type = element.getAttribute('data-type'), tabindex = element.tabIndex || 0
		if(this.busy) { // multi-click prevention
			return
		}
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
		}
		if(this.debug){
			console.warn('menu-open', {path, type, element, tabindex})
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
		this.emit('focus', element)
		switch(type){
			case 'slider':
				this.setupSlider(element)
				break
			case 'check':
				this.check(element)
				break
			default:
				if(type == 'select'){
					this.lastSelectTriggerer = element
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
						this.emit('focus-index', n)
						this.getIndex(n)?.click()
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
			if(!e.fa){
				if(this.icons[e.path] && this.icons[e.path].url.startsWith('fa')) {
					e.fa = this.icons[e.path].url
				}
				if(!e.icon || !e.icon.startsWith('fa')) {
					if(this.defaultIcons[e.type]){
						e.fa = 'fas '+ this.defaultIcons[e.type]
					}
				} else {
					e.fa = e.icon
				}
			}
			if(e.fa && !this.icons[e.path]) {
				this.icons[e.path] = {url: e.fa}
			}
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
		if(e.rawname && e.rawname.includes('[')) {
			e.rawname = this.parseBBCode(e.rawname)
		}
		e.wrapperClass = 'entry-wrapper'
		if(!e.side &&  this.icons[e.path] && this.icons[e.path].cover && (main.config['stretch-logos'] || (e.class && e.class.includes('entry-force-cover')))) {
			e.cover = true
			e.wrapperClass += ' entry-cover-active'
		} else {
			if(e.cover) {
				e.cover = false
			}
			if(e.wrapperClass.includes('entry-cover-active')) {
				e.wrapperClass = e.wrapperClass.replace(new RegExp(' *entry\-cover\-active *', 'g'), ' ')
			}
		}
		if(typeof(e.prepend) != 'string') {
			e.prepend = ''
		}
		e.key = e.path + (e.id || e.url || '') // svelte id, added url to key to fix stream-state processing
		return e
	}
	readClipboard() {
		return new Promise((resolve, reject) => {
			if(window.capacitor) {
				return window.capacitor.clipboard().then(ret => {
					resolve(String(ret.value))
				}).catch(reject)
			}
			if (!navigator.clipboard || !navigator.clipboard.readText) {
				return reject('Clipboard API not available.')
			}	

			let timer, resolved = false
			navigator.clipboard.readText().then(clipboardText => {
				if(resolved) return
				resolved = true
				clearTimeout(timer)
				resolve(clipboardText.trim())
			}).catch(reject)

			timer = setTimeout(() => {
				if(resolved) return
				resolved = true
				console.warn('timeoutId', timeoutId)
				reject('timeout')
			}, 2000)
		})
	}
}