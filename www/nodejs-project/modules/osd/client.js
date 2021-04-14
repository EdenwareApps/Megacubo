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
            entries.forEach((e, i) => {
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
    destroy(name){
        let id = 'osd-entry-' + name, c = this.root.querySelector('#' + id)
        if(c){
            c.parentNode.removeChild(c)
        }
    }
}
