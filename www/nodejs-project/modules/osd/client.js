if(typeof(EventEmitter) == 'undefined'){
    class EventEmitter {
        constructor() {
            this.events = {};
        }
        on(event, listener) {
            if (typeof this.events[event] !== 'object') {
                this.events[event] = [];
            }
            this.events[event].push(listener);
            return () => this.removeListener(event, listener);
        }
        removeListener(event, listener) {
            if (typeof this.events[event] === 'object') {
                const idx = this.events[event].indexOf(listener);
                if (idx > -1) {
                    this.events[event].splice(idx, 1);
                }
            }
        }
        emit(event, ...args) {
            if (typeof this.events[event] === 'object') {
                this.events[event].forEach(listener => listener.apply(this, args));
            }
        }
        once(event, listener) {
            const remove = this.on(event, (...args) => {
                remove();
                listener.apply(this, args);
            })
        }
    }
}

class Speaker {
    constructor(){
        this.messages = []
        this.voice = null
        this.currentMessage = null
        this.pumpDelay = 250
        window.speechSynthesis.addEventListener('voiceschanged', () => {
            this.voice = null
        })
    }
    prepareText(text){
        if(!this.decoder){
            this.decoder = jQuery('<textarea />')
        }
        return this.decoder.html(text.replace(new RegExp('(<([^>]+)>)', 'gi'), '')).text()
    }
    chooseVoice(){
        if(this.voice) return this.voice
        let locale
        if(lang && lang.locale){
            locale = lang.locale
        }
        let voices = window.speechSynthesis.getVoices()
        if(voices.length){
            let localeVoices = voices.filter(v => {
                return v.lang.substr(0, 2) == locale
            })
            if(localeVoices.length){
                voices = localeVoices
            }
            let defaultVoices = voices.filter(v => v.default)
            this.voice = defaultVoices.length ? defaultVoices[0] : voices[0]
            return this.voice
        }
    }
    queue(id, text){
        if(id.indexOf('-sub') != -1) return // skip -sub hint messages to avoid confusion
        this.messages = this.messages.filter(m => {
            if(m.id == id) console.warn('CANCELLING SPEAK', m)
            return m.id != id
        })
        if(this.currentMessage && this.currentMessage.id == id){
            console.warn('CANCELLING ACTIVE SPEAK', this.currentMessage.text)
            window.speechSynthesis.cancel()
            this.currentMessage = null
        }
        this.messages.push({id, text: this.prepareText(text)})
        console.warn('SPEAK MESSAGES', this.messages.slice(0), this.currentMessage)
        setTimeout(() => this.pump(), this.pumpDelay)
    }
    speak(id, text){
        this.queue(id, text)
    }
    pump(){
        if(this.messages.length && !window.speechSynthesis.speaking){
            let message = this.messages.shift()
            const voice = this.chooseVoice()
            const u = new SpeechSynthesisUtterance()
            u.id = message.id
            u.text = message.text
            u.voice = voice
            u.addEventListener('boundary', () => {
                if(!this.currentMessage || (this.currentMessage.id == u.id && this.currentMessage.text != u.text)){
                    console.warn('CANCELLING ACTIVE SPEAK*', this.currentMessage ? this.currentMessage.text : null)
                    window.speechSynthesis.cancel()
                    setTimeout(() => this.pump(), this.pumpDelay)
                }
            })
            u.addEventListener('end', () => {
                console.log('SPEAKED', message.text)
                if(this.currentMessage && this.currentMessage.id == u.id && this.currentMessage.text == u.text){
                    this.currentMessage = null
                }
                setTimeout(() => this.pump(), this.pumpDelay)
            })
            this.currentMessage = message
            window.speechSynthesis.speak(u)
        }
        window.speechSynthesis.resume()
        if(this.messages.length){
            setTimeout(() => this.pump(), this.pumpDelay)
        }
    }
}

class OSDDOMClassHandler extends EventEmitter {
	constructor(){
        super()
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

class OSD extends OSDDOMClassHandler {
	constructor(root, io){
        super()
		if(typeof(root) == 'string'){
			root = document.querySelector(root)
		}
        this.root = root
        this.body = $(body)
        this.io = io
        this._template = '<div class="osd-icon">%icon%</div><div class="osd-text slide-in-from-left"><div>%text%</div></div>'
        this.timers = {};
        this.io.on('osd-show', this.show.bind(this))
        this.io.on('osd-hide', this.hide.bind(this))
        this.observeLayout()
    }
    template(text, icon, name){
        let c = ''
        if(icon){
            if(icon.indexOf('.') == -1){
                icon = '<i class="'+icon+'"></i>'
            } else {
                icon = '<img src="'+icon+'" style="display: none;" onload="this.style.display=&apos;inline-block&apos;" />'
            }
        }
        c = this._template.replace('%text%', text).replace('%icon%', icon || '')
        return c
    }
	show(text, icon, name, time){
        let id = 'osd-entry-' + name, c = this.root.querySelector('#' + id), textOnly
        if(c){
            this.removeClass(c, 'osd-hidden')
            textOnly = c.innerHTML.indexOf(icon +'"') != -1
        } else {
            c = document.createElement('div')
            c.id = id
            this.addClass(c, 'osd-entry')
        }
        if(textOnly){
            c.querySelector('.osd-text > div').innerHTML = text
        } else {
            c.innerHTML = this.template(text, icon, name)
        }
        if(this.root.firstElementChild != c){
            $(this.root).prepend(c)
        }
        if(typeof(this.timers[name]) != 'undefined'){
            clearTimeout(this.timers[name])
        }
        time = this.parseTime(time)
        if(time == -1){
            this.addClass(c, 'osd-persistent')
        } else {
            this.timers[name] = setTimeout(() => {
                this.hide(name)
            }, time)
        }
        if(config && config['osd-speak'] && window.speechSynthesis){
            if(!this.speaker){
                this.speaker = new Speaker()
            }
            this.speaker.speak(name, text)
        }
	}
	hide(name){
        let id = 'osd-entry-' + name, c = this.root.querySelector('#' + id)
        if(c){
            if(this.isPersistent(c)){
                this.addClass(c, 'osd-hidden')
            } else {
                this.destroy(name)
            }
        }
    }
    isPersistent(name){
        let c
        if(typeof(name) == 'string'){
            let id = 'osd-entry-' + name
            c = this.root.querySelector('#' + id)
        } else {
            c = name
        }
        return this.hasClass(c, 'osd-persistent')
    }
    parseTime(s){
        switch(s){
            case 'short':
                s = 3000
                break
            case 'normal':
                s = 5000
                break
            case 'long':
                s = 8000
                break
            case 'persistent':
                s = -1
                break
        }
        return parseFloat(s)
    }
    observeLayout(){
        let atts = {attributes: true, childList: true, characterData: true, subtree:true}, observer = new MutationObserver((mutations) => {
            observer.disconnect() // ensure prevent looping
            this.updateLayout()  
            observer.observe(this.root, atts)
        })
        observer.observe(this.root, atts)
    }
    updateLayout(){
        let entries = this.root.querySelectorAll('.osd-entry:not(.osd-hidden)')
        if(entries.length){
            this.body.addClass('osd')
            let l = 0
            Array.from(entries).filter(e => e.clientHeight).forEach((e, i) => {
                let has = this.hasClass(e, 'osd-highlight')
                if(i != l){
                    if(has){
                        this.removeClass(e, 'osd-highlight')
                    }
                } else {
                    if(!has){
                        this.addClass(e, 'osd-highlight')
                    }
                }
            })
        } else {
            this.body.removeClass('osd')
        }
    }
    textContent(){
        return Array.from(this.root.querySelectorAll('.osd-entry:not(.osd-hidden)')).map(e => e.textContent).join("\r\n")
    }
    destroy(name){
        let id = 'osd-entry-' + name, c = this.root.querySelector('#' + id)
        if(c){
            c.innerHTML = ''
            c.parentNode.removeChild(c)
        }
    }
}
