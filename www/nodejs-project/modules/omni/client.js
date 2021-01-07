

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
            omniInterval: 1500
        }
        this.autoSubmit = !parent.cordova
        this.omniTimer = 0, 
        this.type = '' 
        this.typing = ''
        this.defaultValue = ''
        this.input = jQuery('.explorer-omni input')
        this.element = jQuery('.explorer-omni > span')
        this.setup()
        this.bind()
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
		this.element.on('click', event => {
			if(!event.target.tagName || event.target.tagName.toLowerCase() != 'i' || !this.element.hasClass('selected') || !this.submit()){
				this.focus(true)
			}
		})
		this.input.attr('placeholder', lang.WHAT_TO_WATCH).on('keydown', event => {
			if(event.key === 'Enter'){
				this.submit()
			}
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
	}
	save(){
        this.updateIcon('fas fa-search')
		let val = this.input.val()
		this.input.val('')
		if(val){
			val = val.toLowerCase()
			this.defaultValue = val
		}
		return val
	}
    validateEvent(evt){        
        if(evt.target && evt.target.tagName.match(new RegExp('^(input|textarea)$', 'i')) && evt.target != this.input.get(0)){
            console.warn('INPUT ignored')
            return
        }
        if(evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey){
            console.warn('MODKEY ignored')
            return
        }
        if(['Up', 'Down'].indexOf(evt.key) != -1){
            console.warn('WHEEL ignored')
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
        this.typing = this.input.val()
        if(!this.typing.length){
            return
        }
        this.type = this.isNumeric(this.typing) ? 'numeric' : 'mixed'
        this.updateIcon(this.type == 'numeric' ? 'fas fa-star' : 'fas fa-search')
        if(this.autoSubmit){
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
        let chr = evt.key
        if(evt.target && (evt.target != this.input.get(0))){
            if(evt.key && evt.key.length == 1){
                this.defaultValue = evt.key
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
                if(this.typing.match(new RegExp('[A-Za-z0-9]'))){
                    let pos = -1
                    explorer.currentEntries.some((n, i) => {
                        if(n.name.charAt(0).toLowerCase() == this.typing){
                            pos = i 
                            return true
                        }
                    })
                    if(pos > 0){
                        explorer.focus(explorer.currentElements[pos])
                    }
                }
            } else {
                app.emit('omni', this.typing, this.type)
                this.updateIcon('fas fa-circle-notch fa-spin')
            }
        }
    }
}
