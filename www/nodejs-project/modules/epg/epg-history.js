
const path = require('path'), EntriesGroup = require(path.resolve(__dirname, '../entries-group'))

class History extends EntriesGroup {
    constructor(){
        super('history')
        this.limit = 36
        this.resumed = false
        global.streamer.on('commit', () => {
            if(!streamer.active.info.isLocalFile){
                let time = global.time()
                if(this.timer){
                    clearTimeout(this.timer)
                }
                this.timer = setTimeout(() => {
                    if(global.streamer.active){
                        let entry = global.streamer.active.data
                        entry.historyTime = time
                        this.remove(entry)
                        this.add(entry)
                    }
                }, 90000)
            }
        })
        global.streamer.on('uncommit', () => {
            if(this.timer){
                clearTimeout(this.timer)
            }
        })
        this.on('load', () => {
            if(explorer.path == ''){
                explorer.updateHomeFilters()
            }
        })
    }
    resume(){
        this.ready(() => {
            if(!this.resumed && global.streamer){
                this.resumed = true
                let es = this.get()
                console.log('resuming', es)
                if(es.length){
                    console.log('resuming', es[0], es)
                    global.streamer.play(es[0])
                }
            }
        })
    }
    entry(){
        return {name: global.lang.KEEP_WATCHING, fa: 'fas fa-history', type: 'group', hookId: this.key, renderer: this.entries.bind(this)}
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == global.lang.TOOLS){
                entries.push(this.entry())
            } else if(path == '') {
                let pos = -1, es = this.get()
                console.log('HISTHOOK', es, es.length)
                entries = entries.filter(e => {
                    return e.hookId != this.key
                })
                entries.some((e, i) => {
                    if(e.name == global.lang.IPTV_LISTS){
                        pos = i
                        return true
                    }
                })
                if(es.length){
                    pos = 0
                    let defs = {hookId: this.key, fa: 'fas fa-undo', details: '<i class="fas fa-play-circle"></i> '+ global.lang.CONTINUE}
                    if(global.config.get('show-logos')){
                        defs.servedIcon = global.icons.generate(global.channels.entryTerms(es[0]), es[0].icon)
                    }
                    entries.splice(pos, 0, Object.assign(Object.assign({}, es[0]), defs))
                } else {
                    entries.splice(pos, 0, this.entry())
                }
            }
            resolve(entries)
        })
    }
    entries(e){
        return new Promise((resolve, reject) => {
            let es = this.get()
            es = es.map(e => {
                e.details = global.moment(e.historyTime * 1000).fromNow()
                e = global.channels.toMetaEntry(e, false)
                return e
            })
            if(es.length){
                es.push({name: global.lang.CLEAR, fa: 'fas fa-trash', type: 'action', action: () => {
                    this.clear()
                    global.explorer.refresh()
                }})
            }
            resolve(es)
        })
    }
}

module.exports = History
