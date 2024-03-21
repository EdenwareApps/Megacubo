import { EventEmitter } from 'events'
import { main } from '../bridge/renderer'

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
            this.decoder = document.createElement('span')
        }
        this.decoder.innerHTML = text.replace(new RegExp('(<([^>]+)>)', 'gi'), '')
        return this.decoder.innerText
    }
    chooseVoice(){
        if(this.voice) return this.voice
        let locale
        if(lang && main.lang.locale){
            locale = main.lang.locale
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

export class OSD extends EventEmitter {
	constructor(root){
        super()
		if(typeof(root) == 'string'){
			root = document.querySelector(root)
		}
        this.root = root
        this.messages = []
        this.timers = {}
        main.on('osd-show', this.show.bind(this))
        main.on('osd-hide', this.hide.bind(this))
    }
	show(text, icon, name, time){
        document.body.classList.add('osd')
        const id = 'osd-entry-'+ name
        let i = this.messages.findIndex(m => m.id == id)
        if(i == -1) {
            i = 0
            this.messages.unshift({classes: ['osd-entry'], id})
        }
        this.messages[i].text = text
        if(icon){
            if(icon.indexOf('.') == -1){
                this.messages[i].icon = '<i class="'+ icon +'"></i>'
            } else {
                this.messages[i].icon = '<img src="'+icon+'" style="display: none;" onload="this.style.display=&apos;inline-block&apos;" />'
            }
        } else {
            this.messages[i].icon = ''
        }
        if(typeof(this.timers[name]) != 'undefined'){
            clearTimeout(this.timers[name])
        }
        this.messages[i].time = this.parseTime(time)
        if(this.messages[i].time == -1){
            this.timers[name] && clearTimeout(this.timers[name])
        } else {
            this.messages[i].listener = () => this.hide(name)
            this.timers[name] = setTimeout(this.messages[i].listener, this.messages[i].time)
        }
        this.highlight()
        this.emit('updated')
        if(main.config['osd-speak'] && window.speechSynthesis){
            if(!this.speaker){
                this.speaker = new Speaker()
            }
            this.speaker.speak(name, text)
        }
	}
	hide(name){
        const id = 'osd-entry-' + name
        const i = this.messages.findIndex(m => m.id == id)
        if(i != -1) {
            this.messages.splice(i, 1)
            if(this.messages.length) {
                this.highlight()
            } else {
                document.body.classList.remove('osd')
            }
            this.emit('updated')
        }
    }
    highlight() {        
        this.messages.forEach((m, i) => {
            const has = m.classes.includes('osd-highlight')
            if(i == 0) {
                has || this.messages[i].classes.push('osd-highlight')
            } else if(has) {
                this.messages[i].classes = m.classes.filter(c => c != 'osd-highlight')
            }
        })
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
    textContent(){
        return this.messages.map(m => m.text).join("\r\n")
    }
}
