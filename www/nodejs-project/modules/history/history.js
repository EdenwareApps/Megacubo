
const path = require('path'), EntriesGroup = require(path.resolve(__dirname, '../entries-group'))

class History extends EntriesGroup {
    constructor(){
        super('history')
        this.limit = 36
        this.resumed = false
        global.streamer.on('commit', () => {
            let time = global.storage.time()
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
            }, 120000)
        })
        global.streamer.on('uncommit', () => {
            if(this.timer){
                clearTimeout(this.timer)
            }
        })
    }
    resume(){
        if(!this.resumed && global.streamer && global.config.get('resume')){
            this.resumed = true
            let es = this.get()
            if(es.length){
                global.streamer.play(es[0])
            }
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            this.resume()
            if(path == ''){
                entries.push({name: global.lang.HISTORY, fa: 'fas fa-history', type: 'group', renderer: this.entries.bind(this)})
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
