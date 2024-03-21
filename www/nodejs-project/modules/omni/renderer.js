import { EventEmitter } from 'events'
import { main } from '../bridge/renderer'

class OMNIUtils extends EventEmitter {
    constructor(){
        super()
    }
    isNumeric(chr){
        return !!String(chr).match(new RegExp('^[0-9]+$'))
    }
    isXtraChar(chr){
        return (' -+@!').indexOf(String(chr)) != -1
    }
    isLetter(chr){
        return String(chr).toLowerCase() != String(chr).toUpperCase()
    }    
    isNumberOrLetter(chr){
        return this.isNumeric(chr) || this.isXtraChar(chr) || this.isLetter(chr)
    }
}

export class OMNI extends OMNIUtils {
    constructor(){
        super()
        this.opts = {
            omniInterval: 1500,
            autoSubmit: true
        }
        this.omniTimer = 0
        this.type = ''
        this.typing = ''
        this.defaultValue = ''
        this.element = document.querySelector('.menu-omni > span')
        this.button = document.querySelector('.menu-omni .menu-omni-submit')
        this.input = document.querySelector('.menu-omni input')
        this.rinput = this.input
        this.setup()
        this.bind()
        document.addEventListener('keyup', this.eventHandler.bind(this))
    }
    bind(){
        main.on('omni-enable', () => this.show())
        main.on('omni-disable', () => this.hide())
        main.on('omni-callback', (text, success) => {
            if(success){
                this.save()
            } else {
                this.updateIcon('fas fa-times-circle')
            }
        })
        main.emit('omni-client-ready')
    }
    show(focus) {
        this.element.style.display = 'inline-flex'
        focus && this.focus(true)
    }
    showPortrait() {
        document.body.classList.add('portrait-search')
        this.focus(true)
        this.input.addEventListener('blur', () => {
            document.body.classList.remove('portrait-search')
        }, { once: true })
    }
    hide() {
        this.element.style.display = 'none'
        main.menu.reset()
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
        this.button.addEventListener('click', event => {
            if(!this.element.classList.contains('selected') || !this.submit()){
                this.focus(true)
            }
        })
        this.element.addEventListener('click', event => {
            if(!event.target.tagName || event.target.tagName.toLowerCase() != 'i' || !this.element.classList.contains('selected') || !this.submit()){
                this.focus(true)
            }
        })
        this.input.setAttribute('placeholder', main.lang.WHAT_TO_WATCH)
        this.input.addEventListener('keydown', event => {
            if(event.key === 'Enter') this.submit()
        })
    }
    focus(select){
        this.input.value = this.defaultValue
        if(select){
            this.input.select()
        }
        main.menu.focus(this.element, true)
        this.input.focus()
        this.input.addEventListener('blur', () => {
            main.menu.focus(main.menu.currentElements[0])
            this.save()				
        }, { once: true })
        if(!select) { // as last, move to the end
            this.rinput.selectionStart = this.rinput.selectionEnd = this.rinput.value.length
        }
    }
    save(){
        this.updateIcon('fas fa-search')
        let val = this.input.value
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
        if(main.menu.inModal()){
            var v = document.querySelector('#modal-content input[type="text"]')
            if(v){ // that's some input field on ui?
                v.focus()
                return
            }
        }
        return true
    }
    update(){
        clearTimeout(this.omniTimer)
        this.typing = this.rinput.value
        if(!this.typing.length) return
        this.type = this.isNumeric(this.typing) ? 'numeric' : 'mixed'
        this.updateIcon(this.type == 'numeric' ? 'fas fa-star' : 'fas fa-search')
        if(this.opts.autoSubmit) {
            this.omniTimer = setTimeout(this.trigger.bind(this), this.opts.omniInterval)
        }
    }
    updateIcon(cls){
        let fa = this.element.querySelector('i')
        if(fa.className.indexOf(cls) == -1){
            fa.outerHTML = `<i class="${cls}"></i>`
        }
    }
    eventHandler(evt){
        if(!this.validateEvent(evt)) return
        if(evt.target && evt.target != this.rinput){
            if(evt.key && evt.key.length == 1 && evt.key != ' ') {
                this.defaultValue = evt.key
                if(main.menu.inPlayer() && !main.menu.isExploring()) {
                    main.menu.showWhilePlaying(true, true)
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
                if(lc != '.' && lc != '*') {
                    main.menu.currentEntries.some((n, i) => {
                        if(n.type == 'back') return
                        if(n.name.charAt(0).toLowerCase() == lc){
                            pos = i 
                            return true
                        }
                    })
                    if(pos < 0){
                        main.menu.currentEntries.some((n, i) => {
                            if(n.type == 'back') return
                            if(n.name.charAt(0).toLowerCase() < lc){
                                pos = i
                            } else {
                                return true
                            }
                        })
                    }
                    if(pos < 0){
                        pos = main.menu.currentEntries.length - 1
                    }
                    if(pos > 0){
                        main.menu.focus(main.menu.currentElements[pos])
                    }
                    return
                }
            }
            main.emit('omni', this.typing, this.type)
            this.updateIcon('fas fa-circle-notch fa-spin')
        }
    }
}
