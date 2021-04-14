
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
                if(v.length == 1 && v.charAt(0) != 'h'){
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
    time(){
        return ((new Date()).getTime() / 1000)
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
		mandatory && this.body.addClass('modal-mandatory')
		this.inputHelper.start()
		this.body.addClass('modal')
		this.reset()
	}
	endModal(){
		if(this.inModal()){
			if(this.debug){
				console.log('ENDMODAL', traceback())
			}
			this.inputHelper.stop()
			this.body.removeClass('modal')
			this.emit('modal-end')
			this.emit('pos-modal-end')
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
		this.fxContainer.css('transition', 'none')
		this.fxContainer.css('transform', 'scale(0.96)')
		setTimeout(() => {
			this.fxContainer.css('transition', 'transform 0.2s ease-in-out 0s')
			this.fxContainer.css('transform', 'none')
		}, 0)
	}
	fxNavOut(){
		this.fxContainer.css('transition', 'none')
		this.fxContainer.css('transform', 'scale(1.04)')
		setTimeout(() => {
			this.fxContainer.css('transition', 'transform 0.2s ease-in-out 0s')
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
		return txt.toLowerCase().replace(new RegExp('[^a-z0-9]+', 'g'), '')
	}
	dialog(entries, cb, defaultIndex){
		this.queueDialog(() => {
			console.log('DIALOG', entries, traceback(), cb)
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
					e['tag-icon'] = '<i class="'+ e.fa + '"></i> '
				}
				if(!e.plainText){
					e.plainText = this.plainText(e.text)
				}
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
			this.startModal('<div class="modal-wrap"><div>' + html + '</div></div>')
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
							console.log('MODALFOCUS', p, defaultIndex)
							this.focus(p, false)
						}, 150)
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
		this.queueDialog(() => {
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
		})
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
		this.queueDialog(() => {
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
			}, config['shared-mode-reach'])
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
		})
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
		this.queueDialog(() => {
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
		let results = []
		this.currentEntries.forEach((e, i) => {
			if(!this.ranging || (i >= this.range.start && i <= this.range.end)){
				if(e.url && typeof(this.statusFlags[e.url]) != 'undefined'){
					let element = this.currentElements[i], fa = this.statusFlags[e.url]
					if(element && element.getAttribute('data-type') != 'spacer'){
						let content = ''
						if(fa){
							content = '<i class="' + fa + '"></i>'
						}
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
		this.app.on('dialog', (a, b, c) => {
			this.dialog(a, b, c)
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
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-original-icon="{fa}" data-icon="{servedIcon}" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
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
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-default-value="{value}" data-original-icon="{fa}" data-icon="{servedIcon}" data-question="{question}" data-path="{path}" data-type="{type}" data-multiline="{multiline}" data-placeholder="{placeholder}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{name}</label>
			</span>
			<span class="entry-details">{details}</span>
		</span>
		<span class="entry-icon-image">
			<i class="{fa}" aria-hidden="true"></i>
		</span>
	</span>
</a>`,
			select: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-original-icon="{fa}" data-icon="{servedIcon}" data-question="{question}" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">			
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{name}</label>
			</span>
			<span class="entry-details">{details} {value}</span>
		</span>
		<span class="entry-icon-image">
			<i class="{fa}" aria-hidden="true"></i>
		</span>
	</span>
</a>`,
			slider: `
<a tabindex="{tabindex}" href="{url}" title="{name}" aria-label="{name}" data-default-value="{value}" data-range-start="{range.start}" data-range-end="{range.end}" data-mask="{mask}" data-original-icon="{fa}" data-icon="{servedIcon}" data-question="{question}" data-path="{path}" data-type="{type}" onclick="explorer.action(event, this)">
	<span class="entry-wrapper">
		<span class="entry-data-in">		
			<span class="entry-name" aria-hidden="true">
				<span class="entry-status-flags"></span>
				<label>{name}</label>
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
	render(entries, path, icon){
		if(this.debug){
			console.log("RENDERING", entries)
		}
		this.rendering = true
		clearTimeout(this.touchMovingTimer)
		let tpl, html='', targetScrollTop = 0
		if(typeof(this.selectionMemory[path]) != 'undefined'){
			targetScrollTop = this.selectionMemory[path].scroll
		}
		this.currentEntries = entries
		entries = this.getRange(targetScrollTop)
		this.emit('pre-render', path, this.path)
		this.path = path
		entries.forEach(e => {
			let tpl = this.templates['default']
			if(typeof(this.templates[e.type]) != 'undefined'){
				tpl = this.templates[e.type]
			}
			html += this.renderEntry(e, tpl, path)
		})
		this.lastOpenedElement = null
		this.wrapper.html(html)
		this.currentElements = Array.from(this._wrapper.getElementsByTagName('a'))
		if(this.debug){
			console.log("RENDERING", this.selectedIndex)
		}
		setTimeout(() => {
			if(this.debug){
				console.log("RENDERED")
			}
			this.restoreSelection() // keep it in this timer, or the hell gates will open
			this.emit('render', this.path, icon)
			if(!this.initialized){
				this.initialized = true
				this.emit('init')
			}
			this.rendering = false
		}, 0)
	}
    getRange(targetScrollTop){
		if(typeof(targetScrollTop) != 'number'){
			targetScrollTop = this._wrapper.scrollTop
		}
		this.ranging = false
		let entries = [], tolerance = this.viewSizeX, vs = Math.ceil(this.viewSizeX * this.viewSizeY), minLengthForRanging = vs + (tolerance * 2), shouldRange = config['show-logos'] && this.currentEntries.length >= minLengthForRanging
		if(shouldRange){
			if(targetScrollTop == 0){
				this.range = {start: 0, end: vs}
			} else {
				this.range = getViewportRange(targetScrollTop)
				this.range.end = this.range.start + (vs -1)
			}
			let trange = Object.assign({}, this.range)
			trange.end += tolerance
			if(trange.start >= tolerance){
				trange.start -= tolerance
			}
			this.currentEntries.forEach((e, i) => {
				if((i >= trange.start) && (i <= trange.end)) {
					entries[i] = e
				} else {
					entries[i] = Object.assign(Object.assign({}, e), {type: 'spacer'})
					this.ranging = true
				}
			})
		} else {
			entries = this.currentEntries.slice(0)
		}
        return entries
    }
	updateRange(){
		if(this.ranging){
			var changed = [], shouldUpdateRange = config['show-logos'] && this.currentEntries.length > (this.viewSizeX * this.viewSizeY)
			if(shouldUpdateRange){
				var elements = this.currentElements, entries = this.getRange(this._wrapper.scrollTop)
				entries.sort((a, b) => {
					if(a.type == b.type){
					  return a.tabindex > b.tabindex ? 1 : a.tabindex < b.tabindex ? -1 : 0;
					}			
					return a.type == 'spacer' ? 1 : -1
				})
				if(this.debug){
					console.warn("UPDATING RANGE", entries, traceback())
				}			
				entries.forEach(e => {
					if(e.type){
						var type = elements[e.tabindex].getAttribute('data-type')
						if(this.debug){
							console.warn(e.type, type, elements[e.tabindex], e.tabindex, this.selectedIndex)
						}
						if(e.type != type){
							var tpl = this.templates['default']
							if(typeof(this.templates[e.type]) != 'undefined'){
								tpl = this.templates[e.type]
							}
							var n = this.j(this.renderEntry(e, tpl, this.path)).get(0)
							elements[e.tabindex].parentNode.replaceChild(n, elements[e.tabindex])
							changed.push(n)
						}
					}
				})
				if(changed.length){
					if(this.debug){
						console.warn("UPDATING", changed, this.selectedIndex, this.range)
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
	delayedFocus(element){
		setTimeout(() => {
			if(this.debug){
				console.warn('DELAYED FOCUS', element)
			}
			this.focus(element, false)
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
			this.delayedFocus(element)
		}, multiline, fa)
	}
	setupSelect(entries, path, fa){
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
				this.app.emit('explorer-action', actionPath)
				var element = this.container.find('[data-path="'+path+'"]').get(0)
				if(element){
					element.setAttribute('data-default-value', retPath)
				}
			}
			this.delayedFocus(this.lastSelectTriggerer)
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
			this.delayedFocus(element)
		}, fa)
	}
	open(element){
		this.focus(element, true)
		let timeToLock = 3, path = element.getAttribute('data-path'), type = element.getAttribute('data-type')
		if(this.lastOpenedElement == element && ['back', 'action', 'stream', 'group'].indexOf(type) != -1 && ((this.lastOpenedElementTime + timeToLock) > this.time())){
			if(this.debug){
				console.log('multi-click prevented')
			}
			return
		}
		this.lastOpenedElement = element
		this.lastOpenedElementTime = this.time()
		this.j(element).one('blur', () => {
			this.lastOpenedElement = null
		})
		let tabindex = element.tabIndex
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
		if(!e.servedIcon || e.servedIcon.indexOf('//') == -1){
			e.servedIcon = ''
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