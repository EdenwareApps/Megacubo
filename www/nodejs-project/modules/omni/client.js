

class OMNIUtils extends EventEmitter {
    constructor(){
        super()
    }
    isNumeric(chr){
        return !!String(chr).match(new RegExp('^[0-9]+$'))
    }
    isXtraChar(chr){
        return (' -+@!').indexOf(String(chr)) != -1;
    }
    isLetter(chr){
        return String(chr).toLowerCase() != String(chr).toUpperCase()
    }    
    isNumberOrLetter(chr){
        return this.isNumeric(chr) || this.isXtraChar(chr) || this.isLetter(chr)
    }
}

class OMNI extends OMNIUtils {
    constructor(app){
        super()
        this.opts = {
            omniInterval: 1500,
            autoSubmit: true
        }
        this.omniTimer = 0, 
        this.type = '' 
        this.typing = ''
        this.defaultValue = ''
        this.element = jQuery('.explorer-omni > span')
        this.button = jQuery('.explorer-omni .explorer-omni-submit')
        this.input = jQuery('.explorer-omni input')
        this.rinput = this.input.get(0)
        this.setup()
        this.bind()
        jQuery(document).on('keyup', this.eventHandler.bind(this))
    }
    bind(){
        app.on('omni-enable', () => {
            this.element.css('display', 'inline-flex')
        })
        app.on('omni-callback', (text, success) => {
            if(success){
                this.save()
            } else {                
                this.updateIcon('fas fa-times-circle')
            }
        })
        app.emit('omni-client-ready')
    }
    submit(){
        let val = this.save()
        if(val){
            this.typing = val
            this.type = this.isNumeric(val) ? 'numeric' : 'mixed'
            this.trigger(true)
            return true
        }
    }
	setup(){
		this.button.on('click', event => {
			if(!this.element.hasClass('selected') || !this.submit()){
				this.focus(true)
			}
		})
		this.element.on('click', event => {
			if(!event.target.tagName || event.target.tagName.toLowerCase() != 'i' || !this.element.hasClass('selected') || !this.submit()){
				this.focus(true)
			}
		})
		this.input.attr('placeholder', lang.WHAT_TO_WATCH).on('keydown', event => {
            if(event.key === 'Enter') this.submit()
        })
	}
	focus(select){
        this.input.val(this.defaultValue)
        if(select){
            this.input.trigger('select')
        }
        explorer.focus(this.element, true)
        this.input.trigger('focus').one('blur', () => {
			explorer.focus(explorer.currentElements[0])
			this.save()				
		})
        if(!select) { // as last, move to the end
            this.rinput.selectionStart = this.rinput.selectionEnd = this.rinput.value.length
        }
	}
	save(){
        this.updateIcon('fas fa-search')
		let val = this.input.val()
		if(val){
			val = val.toLowerCase()
			this.defaultValue = val
		}
		return val
	}
    validateEvent(evt){    
        if(evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey){
            console.warn('MODKEY ignored')
            return
        }
        if(evt.key && evt.key.startsWith('Arrow') || ['Up', 'Down', 'Left', 'Right'].includes(evt.key)){
            if(evt.target == this.rinput) {
                switch(evt.key.replace('Arrow', '')) {
                    case 'Right':
                        const isEndOfText = this.rinput.selectionEnd === this.rinput.value.length
                        isEndOfText && this.emit('right')
                        break
                    case 'Left':
                        const isStartOfText = this.rinput.selectionStart === 0
                        isStartOfText && this.emit('left')
                        break
                }
                this.rinputLastKey = evt.key
            }
            return
        }    
        if(evt.target && evt.target.tagName.match(new RegExp('^(input|textarea)$', 'i')) && evt.target != this.rinput){
            console.warn('INPUT ignored')
            return
        }
        if(explorer.inModal()){
            var v = jQuery('#modal-content input[type="text"]:visible:eq(0)')
            if(v.length){ // that's some input field on ui?
                v.get(0).focus()
                return
            }
        }
        return true
    }
    update(){
        clearTimeout(this.omniTimer)
        this.typing = this.rinput.value
        if(!this.typing.length){
            return
        }
        this.type = this.isNumeric(this.typing) ? 'numeric' : 'mixed'
        this.updateIcon(this.type == 'numeric' ? 'fas fa-star' : 'fas fa-search')
        if(this.opts.autoSubmit) {
            this.omniTimer = setTimeout(this.trigger.bind(this), this.opts.omniInterval)
        }
    }
    updateIcon(cls){
        let fa = this.element.find('i')
        if(fa.prop('className').indexOf(cls) == -1){
            fa.replaceWith('<i class="'+ cls +'"></i>')
        }
    }
    eventHandler(evt){
        if(!this.validateEvent(evt)) return
        if(evt.target && evt.target != this.rinput){
            if(evt.key && evt.key.length == 1 && evt.key != ' '){
                this.defaultValue = evt.key
                if(explorer.inPlayer() && !explorer.isExploring()) {
                    menuPlaying(true, true)
                }
                this.focus(false)
                this.update()
            }
        } else {
            this.update()
        }
    }
    trigger(clear){
        console.warn('DIALER TRIGGER', this.type, this.typing)
        if(this.typing){
            if(this.type != 'numeric' && this.typing.length == 1){
                let lc = this.typing.toLowerCase(), pos = -1
                explorer.currentEntries.some((n, i) => {
					if(n.type == 'back') return
                    if(n.name.charAt(0).toLowerCase() == lc){
                        pos = i 
                        return true
                    }
                })
                if(pos < 0){
                    explorer.currentEntries.some((n, i) => {
					if(n.type == 'back') return
                        if(n.name.charAt(0).toLowerCase() < lc){
                            pos = i 
                        } else {
							return true
						}
                    })
                }
                if(pos < 0){
                    pos = explorer.currentEntries.length - 1
                }
                if(pos > 0){
                    explorer.focus(explorer.currentElements[pos])
                }
            } else {
                app.emit('omni', this.typing, this.type)
                this.updateIcon('fas fa-circle-notch fa-spin')
            }
        }
    }
}
