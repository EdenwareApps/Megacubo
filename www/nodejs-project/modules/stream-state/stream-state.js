
const path = require('path'), Tuner = require(path.resolve(__dirname, '../tuner')), Events = require('events')

class StreamState extends Events {
    constructor(){
        super()
        this.debug = false
        this.ttl = (6 * 3600)
        this.data = {}
        this.waiting = {}
        this.clientFailures = {}
        this.statusFlags = {
            offline: 'fas fa-times-circle faclr-red', 
            online: 'fas fa-check-circle faclr-green', 
            waiting: 'fas fa-clock', 
            mega: 'fas fa-layer-group'
        }
        global.storage.get('stream-state', data => {
            if(data){
                Object.assign(this.data, data)
                this.sync()
            }
        })
        global.streamer.on('connecting', () => {
            this.cancelTests()
        })
        global.streamer.on('connecting-failure', data => {
            if(data){
                this.set(data.url, false, true)
            }
            if(global.config.get('auto-testing')){
                this.test(global.explorer.currentStreamEntries())
            }
        })
        global.streamer.on('commit', intent => {
            this.cancelTests()
            this.set(intent.data.url, true, true)
        })
        global.streamer.on('failure', data => {
            if(data){
                this.set(data.url, false, true)
            }
        })
        global.streamer.on('stop', (err, e) => {
            setTimeout(() => {
                if(!streamer.active && !streamer.connecting && config.get('auto-testing')){
                    this.test(global.explorer.currentStreamEntries())                    
                }
            }, 500)
        })
        global.explorer.on('open', () => {
            this.cancelTests()
        })
        global.explorer.on('render', entries => {
            this.cancelTests()
            if(global.config.get('auto-testing') && global.explorer.canApplyStreamTesting(entries)){
                this.test(entries)
            }
        })
        this.on('state', (url, state) => {
            global.ui.emit('set-status-flag', url, this.statusFlags[state ? 'online' : 'offline'])
        })
        global.onexit(() => {
            this.cancelTests()
            this.save()
        })
    }
    supports(e){
        return (e && (!e.type || e.type == 'stream' || (e.class && e.class.indexOf('entry-meta-stream') != -1)))
    }
    get(url){
        if(typeof(this.clientFailures[url]) != 'undefined' && this.clientFailures[url] === true){
            return false
        }
        if(typeof(this.data) == 'object' && typeof(this.data[url]) == 'object' && this.data[url] && typeof(this.data[url].time) != 'undefined' && this.time() < (this.data[url].time + this.ttl)){
            return this.data[url].state
        }
        return null
    }    
    set(url, state, isTrusted){
        if(typeof(this.data) == 'object'){
            if(!isTrusted && typeof(this.clientFailures[url]) != 'undefined'){
                return
            }
            let isMega = global.mega.isMega(url)
            if(!isMega || isTrusted){
                let changed, time = this.time()
                if(typeof(this.waiting[url]) != 'undefined'){
                    changed = true
                    delete this.waiting[url]
                }
                if(typeof(this.data[url]) == 'undefined' || this.data[url].state != state){
                    this.data[url] = {'state': state, time}
                    changed = true
                } else {
                    this.data[url].time = time
                }
                if(isTrusted){
                    if(state){
                        if(typeof(this.clientFailures[url]) != 'undefined'){
                            delete this.clientFailures[url]
                            changed = true
                        }
                    } else {
                        if(typeof(this.clientFailures[url]) == 'undefined'){
                            this.clientFailures[url] = true
                            changed = true
                        }
                    }
                }
                if(changed){
                    this.emit('state', url, state)
                }
            }
        }
    }
    time(){
        return ((new Date()).getTime() / 1000)
    }
    sync(){
        if(global.ui){
            let syncData = {}
            Object.keys(this.data).forEach(url => {
                syncData[url] = this.statusFlags[this.data[url] ? 'online' : 'offline']
            })
            global.ui.emit('sync-status-flags', syncData)
        }
    }
    save(){ // must be sync
        if(typeof(this.data) != 'undefined'){
            global.storage.setSync('stream-state', this.data, true)
        }
    }
    success(entry){
        if(this.debug){
            console.log('success', entry.url, entry.name)
        }
        this.set(entry.url, true)
    }
    failure(entry){
        if(this.debug){
            console.log('failure', entry.url, entry.name)
        }
        this.set(entry.url, false)
    }
    test(entries, name){
        let ctl = new Promise((resolve, reject) => {
            if(this.testing){
                this.testing.finish()
            }
            if(!entries.length){
                return resolve(true)
            }
            if(this.debug){
                console.log('streamState about to test', entries)
            }
            const len = entries.length, nt = {name: global.lang.TEST_STREAMS}, autoTesting = global.config.get('auto-testing')
            if(!autoTesting){
                global.ui.emit('set-loading', nt, true, global.lang.TESTING)
                global.osd.show(global.lang.TESTING + ' 0%', 'fa-mega spin-x-alt', 'stream-state-tester', 'persistent') 
            }
            let retest = [], syncData = {}
            entries = entries.filter(e => {
                if(e.url){
                    if(global.mega.isMega(e.url)){
                        syncData[e.url] = this.statusFlags.mega
                    } else {
                        let state = this.get(e.url)
                        if(typeof(state) == 'boolean'){
                            if(state){
                                syncData[e.url] = this.statusFlags.online
                                this.success(e)
                            } else if(typeof(this.clientFailures[e.url]) != 'undefined') {
                                syncData[e.url] = this.statusFlags.offline
                            } else { // if did it failed previously, move to end of queue to try again after the untested ones
                                syncData[e.url] = this.statusFlags.waiting
                                this.waiting[e.url] = true
                                retest.push(e)
                            }
                            return false
                        }
                        syncData[e.url] = this.statusFlags.waiting
                        this.waiting[e.url] = true
                        return true
                    }
                }                
            })
            global.ui.emit('sync-status-flags', syncData)
            if(retest.length){
                entries = entries.concat(retest)
            }
            this.testing = new Tuner(entries, {
                shadow: true
            }, name)
            this.testing.on('success', this.success.bind(this))
            this.testing.on('failure', this.failure.bind(this))
            this.testing.on('progress', i => {
                if(!autoTesting){
                    global.osd.show(global.lang.TESTING + ' ' + i.progress + '%', 'fa-mega spin-x-alt', 'stream-state-tester', 'persistent') 
                }
            })
            this.testing.on('finish', () => {
                if(this.testing){
                    if(this.debug){
                        console.warn('TESTER FINISH!', nt, this.testing.results, this.testing.states)
                    }
                    global.ui.emit('set-loading', nt, false)
                    if(!autoTesting){
                        global.osd.hide('stream-state-tester')
                    }
                    this.testing.destroy()
                    this.testing = null
                    resolve(true)
                    this.save()
                }
            })
            this.testing.start()
        })
        return ctl
    }
    cancelTests(){
        if(this.testing){
            if(this.debug){
                console.log('streamState cancelTests', global.traceback())
            }
            this.testing.finish()
        }
    }
}

module.exports = StreamState
