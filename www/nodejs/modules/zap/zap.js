const { EventEmitter } = require('events')

class Zap extends EventEmitter {
    constructor(){
        super()
        this.isZapping = false
        this.skips = []
        this.icon = 'fas fa-random'
        global.rendererReady(() => this.init())
    }
    init(){
        const streamer = require('../streamer/main')
        this.title = global.lang.ZAP
        global.menu.addFilter(this.hook.bind(this))
        streamer.on('stop', err => {
            if(this.isZapping){
                this.go().catch(console.error)
            }
        })
        streamer.on('stop-from-client', err => {
            this.setZapping(false, true, true)
        })
        streamer.on('commit', () => {
            if(this.isZapping){
                this.setZapping(true, true)
            }
        })
        global.renderer.on('zap', () => {
            this.go().catch(console.error)
        })
        global.renderer.on('stop', () => {
            this.setZapping(false)
        })
        global.renderer.on('streamer-ready', () => {
            global.renderer.emit('add-player-button', 'zap', 'ZAP', this.icon, 6, 'zap')
        })
    }
    async hook(entries, path){        
        const lists = require('../lists')
        if(path == global.lang.LIVE && lists.loaded() && lists.activeLists.length){
            let pos, has = entries.some((e, i) => {
                if(e.name == this.title){
                    pos = i
                    return true
                }
            })
            if(!has){
                if(typeof(pos) == 'undefined'){
                    pos = 0
                }
                entries.splice(pos, 0, this.entry())
            }
        } else if(path == '' && !global.ALLOW_ADDING_LISTS) {
            const options = require('../options')
            options.insertEntry(this.entry(), entries, -2, [global.lang.OPTIONS, global.lang.TOOLS])
        }
        return entries
    }
    async random(){
        let entries = await this.channelsList()
        let tickets = []
        entries.forEach((e, i) => {
            if(!this.skips.includes(e.name)){
                tickets.push(...Array.from({length: e.weight}, () => i))
            }
        })
        if(tickets.length){
            let ticket = tickets[Math.floor(Math.random() * tickets.length)]
            this.skips.push(entries[ticket].name)
            if(this.skips.length > 20){
                this.skips = this.skips.slice(-20)
            }
            console.log('zap random', entries[ticket])
            return entries[ticket]
        }
    }
    async go(){
        if(this.zappingLocked){
            return
        }
        this.setZapping(true)
        if(this.connecting){
            return
        }
        if(global.tuning && !global.tuning.paused && !global.tuning.finished){ // already resumed tuning
            return
        }
        this.connecting = true
        let entry = await this.random()
        if(entry){
            const mega = require('../mega')
            entry.url = mega.build(entry.name, { mediaType: 'live' })

            const streamer = require('../streamer/main')
            let succeeded = await streamer.play(entry, undefined, true).catch(console.error)
            this.connecting = false
            this.setZapping(true, succeeded)
            if(global.tuning) {
                global.tuning.destroy()
                global.tuning = null
            }
            if(!succeeded){
                return this.go()
            }
            return succeeded === true
        }
    }
    setZapping(state, skipOSD, force){
        if(state && this.zappingLocked){
            return
        }
        this.isZapping = state
        global.renderer.emit('is-zapping', this.isZapping, skipOSD)
        if(!state && force){
            this.zappingLocked = true
            setTimeout(() => this.zappingLocked = false, 2000)
        }
    }
    async channelsList(){
        const lists = require('../lists')
        const watching = require('../watching')
        let channels = [], wdata = {};
        (await watching.entries()).forEach(e => {
            wdata[e.name] = e.users
        });
        Object.keys(global.channels.channelList.channelsIndex).forEach(name => {
            if(!lists.mi.isRadio(name)){
                channels.push({
                    name,
                    weight: wdata[name] || 1,
                    terms: global.channels.channelList.channelsIndex[name]
                })
            }
        })
        return channels
    }
    entry(){
        return {
            name: this.title,
            details: global.lang.ZAP_DESCRIPTION,
            fa: this.icon,
            type: 'action',
            action: () => this.go()
        }
    }
}

module.exports = Zap
