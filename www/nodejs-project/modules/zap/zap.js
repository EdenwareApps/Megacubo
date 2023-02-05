const Events = require('events'), path = require('path')

class Zap extends Events {
    constructor(){
        super()
        this.isZapping = false
        this.skips = []
        this.icon = 'fas fa-random'
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
            global.ui.emit('add-player-button', 'zap', 'ZAP', this.icon, 5, 'zap')
        })
    }
    title(){
        return global.lang.ZAP
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
                    e.name == this.title()
                    if(e.entries && typeof(pos) == 'undefined'){
                        pos = i
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
        let ticket = tickets[Math.floor(Math.random() * tickets.length)]
        this.skips.push(entries[ticket].name)
        if(this.skips.length > 20){
            this.skips = this.skips.slice(-20)
        }
        console.log('zap random', entries[ticket])
        return entries[ticket]
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
        entry.url = global.mega.build(entry.name, {
            mediaType: 'live',
            hlsOnly: 'auto'
        })
       
        console.log('zap prom', entry)
        let succeeded = await global.streamer.playPromise(entry, undefined, true).catch(console.error)
        console.log('zap prom', entry, succeeded)
        this.connecting = false
        this.setZapping(true, succeeded)
        global.tuning && global.tuning.destroy()
        if(!succeeded){
            return this.go()
        }
        return succeeded === true
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
            if(!global.lists.msi.isRadio(name)){
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
            name: this.title(),
            details: global.lang.ZAP_DESCRIPTION,
            fa: this.icon,
            type: 'action',
            action: () => this.go()
        }        
        return entry
    }
}

module.exports = Zap
