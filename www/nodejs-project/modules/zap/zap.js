const Events = require('events'), path = require('path')

class Zap extends Events {
    constructor(){
        super()
        this.isZapping = false
        this.skips = []
        this.icon = 'fas fa-random'
        global.uiReady(() => this.init())
    }
    init(){
        this.title = global.lang.ZAP
        global.explorer.addFilter(this.hook.bind(this))
        global.streamer.on('stop', err => {
            if(this.isZapping){
                this.go().catch(console.error)
            }
        })
        global.streamer.on('stop-from-client', err => {
            this.setZapping(false, true, true)
        })
        global.streamer.on('commit', () => {
            if(this.isZapping){
                this.setZapping(true, true)
            }
        })
        global.ui.on('zap', () => {
            this.go().catch(console.error)
        })
        global.ui.on('stop', () => {
            this.setZapping(false)
        })
        global.ui.on('streamer-ready', () => {
            let dir = '.'+ __dirname.replace(path.dirname(require.main.filename), '').replace(new RegExp('\\\\', 'g'), '/')
            global.ui.emit('load-js', dir + '/client.js')
            global.ui.emit('add-player-button', 'zap', 'ZAP', this.icon, 6, 'zap')
        })
    }
    ready(cb){
        if(this.isReady){
            cb()
        } else {
            this.once('ready', cb)
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == global.lang.LIVE && global.lists.loaded() && global.lists.activeLists.length){
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
            }
            resolve(entries)
        })
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
            entry.url = global.mega.build(entry.name, { mediaType: 'live' })
            let succeeded = await global.streamer.play(entry, undefined, true).catch(console.error)
            this.connecting = false
            this.setZapping(true, succeeded)
            global.tuning && global.tuning.destroy()
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
        global.ui.emit('is-zapping', this.isZapping, skipOSD)
        if(!state && force){
            this.zappingLocked = true
            setTimeout(() => this.zappingLocked = false, 2000)
        }
    }
    async entries(){
        return await global.watching.entries()
    }
    async channelsList(){
        let channels = [], wdata = {};
        (await global.watching.entries()).forEach(e => {
            wdata[e.name] = e.users
        });
        Object.keys(global.channels.channelsIndex).forEach(name => {
            if(!global.lists.mi.isRadio(name)){
                channels.push({
                    name,
                    weight: wdata[name] || 1,
                    terms: global.channels.channelsIndex[name]
                })
            }
        })
        return channels
    }
    entry(){
        const entry = {
            name: this.title,
            details: global.lang.ZAP_DESCRIPTION,
            fa: this.icon,
            type: 'action',
            action: () => this.go()
        }        
        return entry
    }
}

module.exports = Zap
